import type { MemoryRecord, GameEvent } from '../core/types';
import { MemoryRepository } from '../db/repositories/MemoryRepository';
import { getLogger } from '../core/logger';

export interface RetrievalQuery {
  characterId: string;
  playerId: string;
  tags?: string[];
  eventType?: string;
  limit?: number;
  includeRecent?: boolean;
}

/**
 * SQL-first memory retrieval with deduplication.
 * Embedding-based retrieval is an optional fallback (~10-15% of cases).
 */
export class MemoryRetriever {
  private log = getLogger('memory-retriever');

  constructor(private repo: MemoryRepository) {}

  /**
   * Retrieve the most relevant memories for an agent's decision context.
   * Combines importance-based and recency-based retrieval.
   */
  retrieve(query: RetrievalQuery): MemoryRecord[] {
    const limit = query.limit ?? 5;
    const seen = new Set<string>();
    const results: MemoryRecord[] = [];

    const addUnique = (memories: MemoryRecord[]) => {
      for (const m of memories) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          results.push(m);
        }
      }
    };

    // 1. Tag-based retrieval (highest priority)
    if (query.tags && query.tags.length > 0) {
      const tagMemories = this.repo.getEpisodicByTags(
        query.characterId, query.playerId, query.tags, limit,
      );
      addUnique(tagMemories);
    }

    // 2. Event-type retrieval
    if (query.eventType) {
      const eventMemories = this.repo.getEpisodicByEventType(
        query.characterId, query.playerId, query.eventType, limit,
      );
      addUnique(eventMemories);
    }

    // 3. Top importance memories
    const topMemories = this.repo.getEpisodicByCharacter(
      query.characterId, query.playerId, limit,
    );
    addUnique(topMemories);

    // 4. Recent memories (for context freshness)
    if (query.includeRecent !== false) {
      const recentMemories = this.repo.getRecentEpisodic(
        query.characterId, query.playerId, Math.ceil(limit / 2),
      );
      addUnique(recentMemories);
    }

    // Sort by currentImportance descending, return top N
    results.sort((a, b) => b.currentImportance - a.currentImportance);

    // Touch accessed memories
    const final = results.slice(0, limit);
    for (const m of final) {
      this.repo.touchMemory(m.id);
    }

    this.log.debug({
      characterId: query.characterId,
      retrieved: final.length,
      topImportance: final[0]?.currentImportance,
    }, 'Memories retrieved');

    return final;
  }
}
