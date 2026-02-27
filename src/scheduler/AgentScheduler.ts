import type { CharacterState, AgentDecisionRequest, GameState, GameEvent, CharacterProprioception } from '../core/types';
import { ActivityTierManager } from './ActivityTierManager';
import { ToolRegistry } from '../tools/ToolRegistry';
import type { GamePlugin } from '../plugin/GamePlugin';
import { getLogger } from '../core/logger';

/**
 * Determines which agents should run on each tick.
 * Active agents run every fast tick, background on slow ticks.
 * Dormant agents only run when events warrant it.
 */
export class AgentScheduler {
  private log = getLogger('agent-scheduler');
  private dormantRunCounter = new Map<string, number>();

  // Per-tick caches for game state and proprioception
  private cachedGameState: GameState | null = null;
  private cachedProprioception = new Map<string, CharacterProprioception>();

  constructor(
    private tierManager: ActivityTierManager,
    private toolRegistry: ToolRegistry,
    private plugin: GamePlugin | null,
  ) {}

  /**
   * Called at the start of each tick to cache game state.
   * Avoids calling plugin methods 10+ times per tick when processing a batch.
   */
  beginTick(): void {
    this.cachedGameState = null;
    this.cachedProprioception.clear();

    if (this.plugin) {
      this.cachedGameState = this.plugin.getGameState();
    }
  }

  /**
   * Get agents that should run on a fast tick.
   * Only active tier agents run on fast ticks.
   */
  getAgentsForFastTick(
    maxAgents: number,
    playerId: string = 'default',
  ): CharacterState[] {
    const active = this.tierManager.getActiveCharacters();
    return active.slice(0, maxAgents);
  }

  /**
   * Get agents that should run on a slow tick.
   * Background agents run on slow ticks. Some dormant agents run sparsely.
   */
  getAgentsForSlowTick(
    maxAgents: number,
    playerId: string = 'default',
  ): CharacterState[] {
    const background = this.tierManager.getBackgroundCharacters();
    const dormant = this.tierManager.getDormantCharacters();

    // Background agents all run
    const result = [...background];

    // Dormant agents run every 5 slow ticks (sparse)
    for (const d of dormant) {
      const count = (this.dormantRunCounter.get(d.id) ?? 0) + 1;
      this.dormantRunCounter.set(d.id, count);
      if (count >= 5) {
        result.push(d);
        this.dormantRunCounter.set(d.id, 0);
      }
    }

    return result.slice(0, maxAgents);
  }

  /**
   * Build a decision request for a character.
   * Uses cached game state if available (from beginTick).
   */
  buildRequest(
    character: CharacterState,
    playerId: string,
    triggerEvent?: GameEvent,
  ): AgentDecisionRequest {
    // Use cached game state or fetch fresh
    const gameState = this.cachedGameState
      ?? this.plugin?.getGameState()
      ?? { worldTime: Date.now() };

    // Use cached proprioception or fetch fresh
    let proprioception = this.cachedProprioception.get(character.id);
    if (!proprioception) {
      proprioception = this.plugin?.getProprioception(character.id) ?? {};
      this.cachedProprioception.set(character.id, proprioception);
    }

    const availableTools = this.toolRegistry.getAvailableToolsFiltered(
      character.activityTier, character.closeness, character.id,
    );

    const energyMap = { active: 1.0, background: 0.5, dormant: 0.2 };

    return {
      characterId: character.id,
      playerId,
      triggerEvent,
      gameState,
      proprioception,
      availableTools,
      energyLevel: energyMap[character.activityTier],
    };
  }

  setPlugin(plugin: GamePlugin): void {
    this.plugin = plugin;
  }
}
