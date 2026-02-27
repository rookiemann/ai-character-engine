import type { MemoryRecord, GameEvent } from '../core/types';
import { MemoryRepository } from '../db/repositories/MemoryRepository';
import type { ImportanceScorerFn } from './ImportanceScorer';
import { defaultImportanceScorer } from './ImportanceScorer';
import { getLogger } from '../core/logger';

const DEEP_MEMORY_THRESHOLD = 9;
const DEEP_DECAY_RATE = 0.1;
const PERMANENT_MEMORY_THRESHOLD = 10;

/**
 * Tier 2: Episodic Memory - importance-scored events that fade over time.
 * Deep memories (importance >= 9) resist fading.
 */
export class EpisodicMemory {
  private log = getLogger('episodic-memory');

  constructor(
    private repo: MemoryRepository,
    private importanceScorer: ImportanceScorerFn = defaultImportanceScorer,
    private importanceThreshold: number = 3,
  ) {}

  /**
   * Record a game event as an episodic memory if it meets the importance threshold.
   */
  record(
    characterId: string,
    playerId: string,
    event: GameEvent,
    content: string,
    summary: string,
    tags: string[] = [],
  ): MemoryRecord | null {
    const importance = this.importanceScorer(event, characterId);

    if (importance < this.importanceThreshold) {
      this.log.debug({ characterId, eventType: event.type, importance }, 'Event below threshold, skipping');
      return null;
    }

    const isPermanent = importance >= PERMANENT_MEMORY_THRESHOLD;
    const isDeep = !isPermanent && importance >= DEEP_MEMORY_THRESHOLD;
    const decayRate = isPermanent ? 0 : isDeep ? DEEP_DECAY_RATE : 1.0;
    const now = Date.now();

    const memory = this.repo.createEpisodic({
      characterId,
      playerId,
      type: this.eventToMemoryType(event),
      content,
      summary,
      importance,
      currentImportance: importance,
      isDeep,
      isPermanent,
      tags,
      eventType: event.type,
      decayRate,
      createdAt: now,
      lastAccessedAt: now,
    });

    this.log.debug({ characterId, memoryId: memory.id, importance, isDeep }, 'Episodic memory created');
    return memory;
  }

  /**
   * Retrieve top memories by importance for a character.
   */
  retrieve(characterId: string, playerId: string, count: number = 5): MemoryRecord[] {
    const memories = this.repo.getEpisodicByCharacter(characterId, playerId, count);
    // Touch accessed memories
    for (const m of memories) {
      this.repo.touchMemory(m.id);
    }
    return memories;
  }

  /**
   * Retrieve memories matching specific tags.
   */
  retrieveByTags(characterId: string, playerId: string, tags: string[], count: number = 5): MemoryRecord[] {
    return this.repo.getEpisodicByTags(characterId, playerId, tags, count);
  }

  /**
   * Retrieve memories by event type.
   */
  retrieveByEventType(characterId: string, playerId: string, eventType: string, count: number = 5): MemoryRecord[] {
    return this.repo.getEpisodicByEventType(characterId, playerId, eventType, count);
  }

  /**
   * Get recent memories (chronological order).
   */
  getRecent(characterId: string, playerId: string, count: number = 5): MemoryRecord[] {
    return this.repo.getRecentEpisodic(characterId, playerId, count);
  }

  /**
   * Apply decay to all memories. Called on slow tick.
   */
  applyDecay(amount: number): number {
    const affected = this.repo.applyDecay(amount);
    this.log.debug({ affected, amount }, 'Decay applied');
    return affected;
  }

  /**
   * Remove memories that have faded below the threshold.
   */
  prune(threshold: number = 0.5): number {
    const pruned = this.repo.pruneBelow(threshold);
    if (pruned > 0) {
      this.log.info({ pruned, threshold }, 'Memories pruned');
    }
    return pruned;
  }

  private eventToMemoryType(event: GameEvent): MemoryRecord['type'] {
    if (event.type === 'dialogue' || event.type === 'chat') return 'dialogue';
    if (event.source && event.target) return 'interaction';
    return 'observation';
  }
}
