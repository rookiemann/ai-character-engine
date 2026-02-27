import type { MemoryRecord } from '../core/types';
import { MemoryRepository } from '../db/repositories/MemoryRepository';
import { EmbeddingService } from '../inference/EmbeddingService';
import { getLogger } from '../core/logger';

/**
 * Expansion 11: Semantic Memory Retrieval
 *
 * Augments the SQL-first retriever with embedding-based semantic search.
 * Used as a fallback when tag/importance retrieval doesn't find
 * contextually relevant results (~10-15% of cases).
 */
export class SemanticRetriever {
  private log = getLogger('semantic-retriever');
  private embeddingCache = new Map<string, number[]>(); // memoryId → embedding

  constructor(
    private repo: MemoryRepository,
    private embedding: EmbeddingService,
  ) {}

  /**
   * Search memories by semantic similarity to a query.
   */
  async search(
    characterId: string,
    playerId: string,
    query: string,
    limit: number = 5,
  ): Promise<MemoryRecord[]> {
    try {
      // Get query embedding
      const queryEmbedding = await this.embedding.embed(query);

      // Get all memories for this character
      const allMemories = this.repo.getEpisodicByCharacter(characterId, playerId, 50);
      if (allMemories.length === 0) return [];

      // Get or compute embeddings for all memories
      const memoryEmbeddings = await this.getEmbeddings(allMemories);

      // Score by cosine similarity
      const scored = allMemories.map((mem, i) => ({
        memory: mem,
        similarity: EmbeddingService.cosineSimilarity(queryEmbedding, memoryEmbeddings[i]),
      }));

      // Sort by similarity, return top N
      scored.sort((a, b) => b.similarity - a.similarity);
      const results = scored.slice(0, limit).map(s => s.memory);

      this.log.debug({
        characterId,
        query: query.slice(0, 50),
        results: results.length,
        topSimilarity: scored[0]?.similarity,
      }, 'Semantic search complete');

      return results;
    } catch (err) {
      this.log.warn({ error: (err as Error).message }, 'Semantic search failed, falling back');
      return [];
    }
  }

  /**
   * Pre-compute embeddings for memories that don't have them.
   */
  async indexMemories(memories: MemoryRecord[]): Promise<void> {
    const unindexed = memories.filter(m => !this.embeddingCache.has(m.id));
    if (unindexed.length === 0) return;

    try {
      const texts = unindexed.map(m => m.summary || m.content);
      const embeddings = await this.embedding.embedBatch(texts);

      for (let i = 0; i < unindexed.length; i++) {
        this.embeddingCache.set(unindexed[i].id, embeddings[i]);
      }

      this.log.debug({ indexed: unindexed.length }, 'Memories indexed');
    } catch (err) {
      this.log.warn({ error: (err as Error).message }, 'Memory indexing failed');
    }
  }

  /**
   * Clear the embedding cache.
   */
  clearCache(): void {
    this.embeddingCache.clear();
  }

  private async getEmbeddings(memories: MemoryRecord[]): Promise<number[][]> {
    const toCompute: { index: number; text: string }[] = [];
    const result: number[][] = new Array(memories.length);

    for (let i = 0; i < memories.length; i++) {
      const cached = this.embeddingCache.get(memories[i].id);
      if (cached) {
        result[i] = cached;
      } else {
        toCompute.push({ index: i, text: memories[i].summary || memories[i].content });
      }
    }

    if (toCompute.length > 0) {
      const embeddings = await this.embedding.embedBatch(toCompute.map(c => c.text));
      for (let j = 0; j < toCompute.length; j++) {
        result[toCompute[j].index] = embeddings[j];
        this.embeddingCache.set(memories[toCompute[j].index].id, embeddings[j]);
      }
    }

    return result;
  }
}
