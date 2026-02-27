import type {
  MemoryRecord,
  GameEvent,
  CharacterState,
  CharacterSummaryRecord,
  WorkingMemoryEntry,
} from '../core/types';
import { WorkingMemory } from './WorkingMemory';
import { EpisodicMemory } from './EpisodicMemory';
import { CharacterSummary } from './CharacterSummary';
import { MemoryRetriever, type RetrievalQuery } from './MemoryRetriever';
import { MemoryRepository } from '../db/repositories/MemoryRepository';
import type { ImportanceScorerFn } from './ImportanceScorer';
import { defaultImportanceScorer, createCompositeScorer } from './ImportanceScorer';
import { TypedEventEmitter } from '../core/events';
import { getLogger } from '../core/logger';

export interface MemoryManagerConfig {
  workingMemorySize: number;
  episodicRetrievalCount: number;
  importanceThreshold: number;
  decayInterval: number;
  pruneThreshold: number;
  summaryRegenerateInterval: number;
}

/**
 * Orchestrates all 3 memory tiers:
 * T1 Working (ring buffer) → T2 Episodic (importance-scored, fading) → T3 Summary (LLM-compressed)
 */
export class MemoryManager {
  public readonly working: WorkingMemory;
  public readonly episodic: EpisodicMemory;
  public readonly summary: CharacterSummary;
  public readonly retriever: MemoryRetriever;

  private ticksSinceDecay = 0;
  private ticksSinceSummary = new Map<string, number>();
  private log = getLogger('memory-manager');

  constructor(
    private repo: MemoryRepository,
    private config: MemoryManagerConfig,
    private emitter: TypedEventEmitter,
    importanceScorer?: ImportanceScorerFn,
  ) {
    this.working = new WorkingMemory(repo, config.workingMemorySize);
    this.episodic = new EpisodicMemory(repo, importanceScorer ?? defaultImportanceScorer, config.importanceThreshold);
    this.summary = new CharacterSummary(repo);
    this.retriever = new MemoryRetriever(repo);
  }

  /**
   * Record a game event into the memory system.
   * Returns the episodic memory if created, null if below threshold.
   */
  recordEvent(
    characterId: string,
    playerId: string,
    event: GameEvent,
    content: string,
    summary: string,
    tags: string[] = [],
  ): MemoryRecord | null {
    const memory = this.episodic.record(characterId, playerId, event, content, summary, tags);

    if (memory) {
      this.emitter.emit('memory:created', memory);
    }

    return memory;
  }

  /**
   * Create a permanent (trauma) memory that never decays or gets pruned.
   * Use for devastating events: death of a loved one, betrayal, near-death, etc.
   */
  recordTrauma(
    characterId: string,
    playerId: string,
    content: string,
    summary: string,
    tags: string[] = [],
    eventType?: string,
  ): MemoryRecord {
    const now = Date.now();
    const memory = this.repo.createEpisodic({
      characterId,
      playerId,
      type: 'observation',
      content,
      summary,
      importance: 10,
      currentImportance: 10,
      isDeep: false,
      isPermanent: true,
      tags: [...tags, 'trauma'],
      eventType,
      decayRate: 0,
      createdAt: now,
      lastAccessedAt: now,
    });

    this.emitter.emit('memory:created', memory);
    this.log.info({ characterId, memoryId: memory.id }, 'Trauma memory created (permanent)');
    return memory;
  }

  /**
   * Add to working memory (conversation buffer).
   */
  addWorkingMemory(
    characterId: string,
    playerId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
  ): WorkingMemoryEntry {
    return this.working.add(characterId, playerId, role, content);
  }

  /**
   * Get full memory context for an agent decision.
   * Returns working memory + relevant episodic memories + character summary.
   */
  getContext(characterId: string, playerId: string, query?: Partial<RetrievalQuery>): {
    workingMemory: WorkingMemoryEntry[];
    episodicMemories: MemoryRecord[];
    characterSummary: CharacterSummaryRecord | null;
  } {
    const workingMem = this.working.get(characterId, playerId);
    const episodicMem = this.retriever.retrieve({
      characterId,
      playerId,
      limit: this.config.episodicRetrievalCount,
      ...query,
    });
    const summaryRec = this.summary.get(characterId, playerId);

    return {
      workingMemory: workingMem,
      episodicMemories: episodicMem,
      characterSummary: summaryRec,
    };
  }

  /**
   * Called on slow tick. Handles decay and pruning.
   */
  onSlowTick(): void {
    this.ticksSinceDecay++;

    if (this.ticksSinceDecay >= this.config.decayInterval) {
      this.ticksSinceDecay = 0;
      const decayed = this.episodic.applyDecay(0.1);
      const pruned = this.episodic.prune(this.config.pruneThreshold);

      if (pruned > 0) {
        this.log.info({ decayed, pruned }, 'Memory maintenance complete');
      }
    }
  }

  /**
   * Check if a character's summary needs regeneration.
   */
  needsSummaryRegeneration(characterId: string, playerId: string): boolean {
    const key = `${characterId}:${playerId}`;
    const ticks = this.ticksSinceSummary.get(key) ?? this.config.summaryRegenerateInterval;
    this.ticksSinceSummary.set(key, ticks + 1);
    return ticks >= this.config.summaryRegenerateInterval;
  }

  /**
   * Mark summary as regenerated (reset tick counter).
   */
  markSummaryRegenerated(characterId: string, playerId: string): void {
    const key = `${characterId}:${playerId}`;
    this.ticksSinceSummary.set(key, 0);
  }

  /**
   * Build the LLM prompt for summary regeneration.
   */
  buildSummaryPrompt(character: CharacterState, playerId: string): string {
    const recentMemories = this.episodic.getRecent(character.id, playerId, 10);
    const existing = this.summary.get(character.id, playerId);
    return this.summary.buildSummaryPrompt(character, recentMemories, existing);
  }

  /**
   * Store a regenerated summary.
   */
  updateSummary(
    characterId: string,
    playerId: string,
    summaryText: string,
    relationshipNotes: string,
    keyFacts: string[],
  ): CharacterSummaryRecord {
    const record = this.summary.update(characterId, playerId, summaryText, relationshipNotes, keyFacts);
    this.emitter.emit('memory:summaryUpdated', characterId);
    this.markSummaryRegenerated(characterId, playerId);
    return record;
  }
}
