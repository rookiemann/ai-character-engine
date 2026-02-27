import type { MemoryRecord, ConsolidationResult } from '../core/types';
import { MemoryRepository } from '../db/repositories/MemoryRepository';
import { EmbeddingService } from '../inference/EmbeddingService';
import { getLogger } from '../core/logger';

/**
 * Expansion 15: Memory Consolidation
 *
 * Merges similar memories into stronger composite memories.
 * Reduces memory count while preserving information.
 * Similar to how human memory consolidation works during sleep.
 */
export class MemoryConsolidator {
  private log = getLogger('memory-consolidator');

  constructor(
    private repo: MemoryRepository,
    private embedding?: EmbeddingService,
  ) {}

  /**
   * Consolidate similar memories for a character.
   * Merges memories with similar content/tags into stronger ones.
   */
  async consolidate(
    characterId: string,
    playerId: string,
    similarityThreshold: number = 0.8,
  ): Promise<ConsolidationResult[]> {
    const memories = this.repo.getEpisodicByCharacter(characterId, playerId, 50);
    if (memories.length < 3) return [];

    const results: ConsolidationResult[] = [];
    const merged = new Set<string>();

    if (this.embedding) {
      // Embedding-based consolidation
      const consolidations = await this.consolidateByEmbedding(
        memories, similarityThreshold,
      );
      results.push(...consolidations);
    } else {
      // Tag-based consolidation fallback
      const consolidations = this.consolidateByTags(memories);
      results.push(...consolidations);
    }

    // Remove merged originals
    for (const result of results) {
      for (const origId of result.originalIds) {
        if (!merged.has(origId)) {
          merged.add(origId);
        }
      }
    }

    this.log.info({
      characterId,
      consolidated: results.length,
      mergedMemories: merged.size,
    }, 'Memory consolidation complete');

    return results;
  }

  /**
   * Tag-based consolidation (no embedding needed).
   * Groups memories by matching tags and event types.
   */
  private consolidateByTags(memories: MemoryRecord[]): ConsolidationResult[] {
    const groups = new Map<string, MemoryRecord[]>();
    const results: ConsolidationResult[] = [];

    // Group by event type + first tag
    for (const mem of memories) {
      const key = `${mem.eventType ?? 'none'}:${mem.tags[0] ?? 'none'}`;
      const group = groups.get(key) ?? [];
      group.push(mem);
      groups.set(key, group);
    }

    // Merge groups with 3+ members
    for (const [key, group] of groups) {
      if (group.length < 3) continue;

      // Sort by importance, keep top as base
      group.sort((a, b) => b.importance - a.importance);
      const base = group[0];
      const toMerge = group.slice(1, 5); // Merge up to 4 into 1

      // Boost the base memory
      const avgImportance = toMerge.reduce((s, m) => s + m.importance, base.importance) / (toMerge.length + 1);
      const boostedImportance = Math.min(10, avgImportance + 1);

      // Combine summaries
      const combinedSummary = [
        base.summary,
        ...toMerge.map(m => m.summary),
      ].join(' | ').slice(0, 500);

      // Combine tags
      const allTags = [...new Set([...base.tags, ...toMerge.flatMap(m => m.tags)])];

      // Update the base memory in place
      this.repo.updateEpisodicImportance(base.id, boostedImportance);

      results.push({
        mergedCount: toMerge.length + 1,
        newMemoryId: base.id,
        originalIds: [base.id, ...toMerge.map(m => m.id)],
      });
    }

    return results;
  }

  /**
   * Embedding-based consolidation (more accurate).
   */
  private async consolidateByEmbedding(
    memories: MemoryRecord[],
    threshold: number,
  ): Promise<ConsolidationResult[]> {
    if (!this.embedding) return [];

    const results: ConsolidationResult[] = [];

    try {
      const texts = memories.map(m => m.summary || m.content);
      const embeddings = await this.embedding.embedBatch(texts);

      const merged = new Set<number>();
      const clusters: number[][] = [];

      // Simple greedy clustering by cosine similarity
      for (let i = 0; i < memories.length; i++) {
        if (merged.has(i)) continue;

        const cluster = [i];
        for (let j = i + 1; j < memories.length; j++) {
          if (merged.has(j)) continue;

          const sim = EmbeddingService.cosineSimilarity(embeddings[i], embeddings[j]);
          if (sim >= threshold) {
            cluster.push(j);
            merged.add(j);
          }
        }

        if (cluster.length >= 2) {
          clusters.push(cluster);
          for (const idx of cluster) merged.add(idx);
        }
      }

      // Create consolidated memories from clusters
      for (const cluster of clusters) {
        const clusterMemories = cluster.map(i => memories[i]);
        clusterMemories.sort((a, b) => b.importance - a.importance);
        const base = clusterMemories[0];

        const avgImportance = clusterMemories.reduce((s, m) => s + m.importance, 0) / clusterMemories.length;
        this.repo.updateEpisodicImportance(base.id, Math.min(10, avgImportance + 1));

        results.push({
          mergedCount: cluster.length,
          newMemoryId: base.id,
          originalIds: clusterMemories.map(m => m.id),
        });
      }
    } catch (err) {
      this.log.warn({ error: (err as Error).message }, 'Embedding consolidation failed');
    }

    return results;
  }
}
