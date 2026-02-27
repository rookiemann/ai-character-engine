import type { TickConfig, GameEvent } from '../core/types';
import { AgentScheduler } from './AgentScheduler';
import { BatchProcessor } from './BatchProcessor';
import { ActivityTierManager } from './ActivityTierManager';
import { ProximityManager } from '../proximity/ProximityManager';
import { MemoryManager } from '../memory/MemoryManager';
import { InferenceService } from '../inference/InferenceService';
import { AgentRegistry } from '../agent/AgentRegistry';
import { TypedEventEmitter } from '../core/events';
import type { GamePlugin } from '../plugin/GamePlugin';
import type { PerceptionManager } from '../agent/PerceptionManager';
import { DEFAULT_TICK } from '../core/config';
import { getLogger } from '../core/logger';

/**
 * Master tick loop - drives the entire simulation.
 *
 * Fast tick (1.5-5s): Active-tier agents only
 * Slow tick (30s-30min): Background + dormant agents, maintenance
 */
export class TickScheduler {
  private config: TickConfig;
  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private fastTickCount = 0;
  private slowTickCount = 0;
  private inflightCount = 0;
  private perception: PerceptionManager | null = null;
  private log = getLogger('tick-scheduler');

  constructor(
    private agentScheduler: AgentScheduler,
    private batchProcessor: BatchProcessor,
    private tierManager: ActivityTierManager,
    private proximity: ProximityManager,
    private memory: MemoryManager,
    private emitter: TypedEventEmitter,
    private plugin: GamePlugin | null,
    config?: Partial<TickConfig>,
    private inference?: InferenceService,
    private agentRegistry?: AgentRegistry,
  ) {
    this.config = { ...DEFAULT_TICK, ...config };
  }

  /**
   * Set the perception manager for location-based event filtering.
   */
  setPerception(perception: PerceptionManager): void {
    this.perception = perception;
  }

  /**
   * Start the tick loops.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.log.info({
      fastTickMs: this.config.fastTickMs,
      slowTickMs: this.config.slowTickMs,
      batchSize: this.config.batchSize,
    }, 'Tick scheduler started');

    // Fast tick loop
    this.fastTimer = setInterval(() => {
      this.onFastTick().catch(err => {
        this.log.error({ error: err.message }, 'Fast tick error');
        this.emitter.emit('engine:error', err);
      });
    }, this.config.fastTickMs);

    // Slow tick loop
    this.slowTimer = setInterval(() => {
      this.onSlowTick().catch(err => {
        this.log.error({ error: err.message }, 'Slow tick error');
        this.emitter.emit('engine:error', err);
      });
    }, this.config.slowTickMs);
  }

  /**
   * Stop the tick loops. Waits for in-flight ticks to complete.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.fastTimer) {
      clearInterval(this.fastTimer);
      this.fastTimer = null;
    }
    if (this.slowTimer) {
      clearInterval(this.slowTimer);
      this.slowTimer = null;
    }

    // Wait for in-flight ticks to finish (use generous timeout for slow LLM responses)
    const deadline = Date.now() + 90000;
    while (this.inflightCount > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }

    if (this.inflightCount > 0) {
      this.log.warn({ inflightCount: this.inflightCount }, 'Shutdown drain timeout - some requests still in-flight');
    }

    this.log.info({
      fastTicks: this.fastTickCount,
      slowTicks: this.slowTickCount,
    }, 'Tick scheduler stopped');
  }

  /**
   * Manually trigger a fast tick (for testing or event-driven usage).
   */
  async triggerFastTick(): Promise<void> {
    await this.onFastTick();
  }

  /**
   * Manually trigger a slow tick.
   */
  async triggerSlowTick(): Promise<void> {
    await this.onSlowTick();
  }

  /**
   * Inject an event that triggers immediate processing for relevant agents.
   * Finds characters by: direct target, same location, or active tier.
   * Supports plugin event filtering via filterEvent hook.
   */
  async injectEvent(event: GameEvent, playerId: string = 'default'): Promise<void> {
    this.emitter.emit('game:event', event);

    const targets: string[] = [];

    // 1. Direct target always runs
    if (event.target) targets.push(event.target);

    // 2. Source character also processes (if it's a character)
    if (event.source && event.source.startsWith('char')) {
      if (!targets.includes(event.source)) targets.push(event.source);
    }

    // 3. If high importance and we have a registry, also notify active characters
    if (event.importance && event.importance >= 7 && this.agentRegistry) {
      const active = this.tierManager.getActiveCharacters();
      for (const c of active) {
        if (!targets.includes(c.id)) targets.push(c.id);
      }
    }

    if (targets.length === 0) return;

    // Apply plugin event filtering
    const pluginFiltered = this.plugin?.filterEvent
      ? targets.filter(id => this.plugin!.filterEvent!(id, event) !== false)
      : targets;

    // Apply perception-based filtering (same location)
    const filteredTargets = this.perception
      ? this.perception.filterByPerception(event, pluginFiltered)
      : pluginFiltered;

    if (filteredTargets.length === 0) return;

    // Cache game state for this event batch
    this.agentScheduler.beginTick();

    // Build requests for all targeted characters
    const requests = filteredTargets
      .map(id => {
        const char = this.agentRegistry?.get(id);
        if (!char) return null;
        return this.agentScheduler.buildRequest(char, playerId, event);
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (requests.length > 0) {
      await this.batchProcessor.processSingleBatch(requests);
    }
  }

  /**
   * Update tick configuration at runtime.
   * Restarts timers if intervals change.
   */
  updateConfig(updates: Partial<TickConfig>): void {
    const oldFast = this.config.fastTickMs;
    const oldSlow = this.config.slowTickMs;

    this.config = { ...this.config, ...updates };

    // Update batch processor batch size
    if (updates.batchSize !== undefined) {
      (this.batchProcessor as any).batchSize = updates.batchSize;
    }

    // Restart timers if intervals changed and we're running
    if (this.running && (this.config.fastTickMs !== oldFast || this.config.slowTickMs !== oldSlow)) {
      if (this.fastTimer) clearInterval(this.fastTimer);
      if (this.slowTimer) clearInterval(this.slowTimer);

      this.fastTimer = setInterval(() => {
        this.onFastTick().catch(err => {
          this.log.error({ error: err.message }, 'Fast tick error');
          this.emitter.emit('engine:error', err);
        });
      }, this.config.fastTickMs);

      this.slowTimer = setInterval(() => {
        this.onSlowTick().catch(err => {
          this.log.error({ error: err.message }, 'Slow tick error');
          this.emitter.emit('engine:error', err);
        });
      }, this.config.slowTickMs);

      this.log.info({ fastTickMs: this.config.fastTickMs, slowTickMs: this.config.slowTickMs }, 'Tick timers restarted');
    }
  }

  /**
   * Regenerate Tier 3 character summaries for characters that need it.
   */
  private async regenerateSummaries(): Promise<void> {
    if (!this.inference || !this.agentRegistry) return;

    const allChars = this.agentRegistry.getAll();
    const playerId = 'default';

    for (const char of allChars) {
      // Bail early if stopped mid-loop
      if (!this.running) return;

      // Only regen for active/background characters
      if (char.activityTier === 'dormant') continue;

      if (!this.memory.needsSummaryRegeneration(char.id, playerId)) continue;

      try {
        const prompt = this.memory.buildSummaryPrompt(char, playerId);
        const response = await this.inference!.complete({
          messages: [
            { role: 'system', content: 'You are a concise summarizer. Respond only with valid JSON.' },
            { role: 'user', content: prompt },
          ],
          tier: 'light',
          maxTokens: 300,
          temperature: 0.3,
          characterId: char.id,
        });

        // Skip DB write if stopped while waiting for LLM
        if (!this.running) return;

        // Parse the JSON response
        try {
          const jsonMatch = response.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            this.memory.updateSummary(
              char.id,
              playerId,
              parsed.summary ?? '',
              parsed.relationshipNotes ?? '',
              parsed.keyFacts ?? [],
            );
            this.log.debug({ characterId: char.id }, 'Summary regenerated');
          }
        } catch {
          if (!this.running) return;
          // If JSON parse fails, use raw text as summary
          this.memory.updateSummary(char.id, playerId, response.content, '', []);
        }
      } catch (err) {
        // Only log if still running (shutdown errors are expected)
        if (this.running) {
          this.log.warn({ characterId: char.id, error: (err as Error).message }, 'Summary regen failed');
        }
      }
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get stats(): { fastTicks: number; slowTicks: number; running: boolean } {
    return {
      fastTicks: this.fastTickCount,
      slowTicks: this.slowTickCount,
      running: this.running,
    };
  }

  private async onFastTick(): Promise<void> {
    if (!this.running) return;
    this.inflightCount++;
    try {
      this.fastTickCount++;
      const timestamp = Date.now();

      // Cache game state for this tick
      this.agentScheduler.beginTick();

      this.emitter.emit('tick:fast', timestamp);

      // Get active agents for this tick
      const agents = this.agentScheduler.getAgentsForFastTick(
        this.config.maxAgentsPerFastTick,
      );

      if (agents.length === 0) return;

      // Build decision requests
      const requests = agents.map(agent =>
        this.agentScheduler.buildRequest(agent, 'default'),
      );

      // Process in batches (concurrent LLM calls)
      await this.batchProcessor.processBatches(requests);

      // Plugin fast tick hook
      this.plugin?.onFastTick?.(timestamp);
    } finally {
      this.inflightCount--;
    }
  }

  private async onSlowTick(): Promise<void> {
    if (!this.running) return;
    this.inflightCount++;
    try {
      this.slowTickCount++;
      const timestamp = Date.now();

      // Cache game state for this tick
      this.agentScheduler.beginTick();

      this.emitter.emit('tick:slow', timestamp);

      // Check running before DB-heavy operations (may have been stopped mid-tick)
      if (!this.running) return;

      // 1. Refresh tier assignments
      this.tierManager.refreshTiers('default');

      // 2. Apply proximity decay
      this.proximity.applyDecay('default');

      // 3. Memory maintenance (decay + prune)
      this.memory.onSlowTick();

      // 4. Summary auto-regeneration for active/background characters
      if (this.running && this.inference && this.agentRegistry) {
        await this.regenerateSummaries();
      }

      // 5. Get background/dormant agents for this tick
      if (!this.running) return;
      const agents = this.agentScheduler.getAgentsForSlowTick(
        this.config.maxAgentsPerSlowTick,
      );

      if (agents.length > 0) {
        const requests = agents.map(agent =>
          this.agentScheduler.buildRequest(agent, 'default'),
        );
        await this.batchProcessor.processBatches(requests);
      }

      // Plugin slow tick hook
      this.plugin?.onSlowTick?.(timestamp);
    } finally {
      this.inflightCount--;
    }
  }
}
