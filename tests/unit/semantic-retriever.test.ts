import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SemanticRetriever } from '../../src/memory/SemanticRetriever';
import { makeMemoryRecord } from '../helpers/factories';

function createMockRepo() {
  return {
    getEpisodicByCharacter: vi.fn().mockReturnValue([]),
  } as any;
}

function createMockEmbedding() {
  let callCount = 0;
  return {
    embed: vi.fn().mockImplementation(async (text: string) => {
      // Return a fixed vector for the query
      return [1, 0, 0];
    }),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
      return texts.map((text, i) => {
        // First memory very similar to query, others less so
        const similarity = 1 - i * 0.3;
        return [similarity, Math.sqrt(1 - similarity * similarity), 0];
      });
    }),
  } as any;
}

describe('SemanticRetriever', () => {
  let retriever: SemanticRetriever;
  let repo: any;
  let embedding: any;

  beforeEach(() => {
    repo = createMockRepo();
    embedding = createMockEmbedding();
    retriever = new SemanticRetriever(repo, embedding);
  });

  it('should search memories sorted by similarity', async () => {
    const memories = [
      makeMemoryRecord('m1', { summary: 'Fought a dragon' }),
      makeMemoryRecord('m2', { summary: 'Traded at market' }),
      makeMemoryRecord('m3', { summary: 'Rested at camp' }),
    ];
    repo.getEpisodicByCharacter.mockReturnValue(memories);

    const results = await retriever.search('c1', 'default', 'battle with dragon', 2);
    expect(results.length).toBe(2);
    // First result should be most similar (based on our mock embeddings)
    expect(results[0].id).toBe('m1');
  });

  it('should respect limit parameter', async () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      makeMemoryRecord(`m${i}`, { summary: `Memory ${i}` }),
    );
    repo.getEpisodicByCharacter.mockReturnValue(memories);

    const results = await retriever.search('c1', 'default', 'test', 3);
    expect(results.length).toBe(3);
  });

  it('should return empty array for no memories', async () => {
    repo.getEpisodicByCharacter.mockReturnValue([]);
    const results = await retriever.search('c1', 'default', 'anything');
    expect(results).toEqual([]);
  });

  it('should return empty array on embedding failure', async () => {
    embedding.embed.mockRejectedValue(new Error('Service down'));
    const memories = [makeMemoryRecord('m1', { summary: 'Test' })];
    repo.getEpisodicByCharacter.mockReturnValue(memories);

    const results = await retriever.search('c1', 'default', 'query');
    expect(results).toEqual([]);
  });

  // --- indexMemories ---

  it('should index unindexed memories', async () => {
    const memories = [
      makeMemoryRecord('m1', { summary: 'Memory 1' }),
      makeMemoryRecord('m2', { summary: 'Memory 2' }),
    ];
    await retriever.indexMemories(memories);
    expect(embedding.embedBatch).toHaveBeenCalledWith(['Memory 1', 'Memory 2']);
  });

  it('should skip already cached memories', async () => {
    const memories = [makeMemoryRecord('m1', { summary: 'Memory 1' })];
    await retriever.indexMemories(memories);
    embedding.embedBatch.mockClear();

    // Index again - should skip
    await retriever.indexMemories(memories);
    expect(embedding.embedBatch).not.toHaveBeenCalled();
  });

  it('should handle indexing failure gracefully', async () => {
    embedding.embedBatch.mockRejectedValue(new Error('Service down'));
    const memories = [makeMemoryRecord('m1', { summary: 'Test' })];
    await retriever.indexMemories(memories); // Should not throw
  });

  // --- clearCache ---

  it('should clear embedding cache', async () => {
    const memories = [makeMemoryRecord('m1', { summary: 'Memory 1' })];
    await retriever.indexMemories(memories);
    retriever.clearCache();

    // After clearing, indexing should re-compute embeddings
    await retriever.indexMemories(memories);
    expect(embedding.embedBatch).toHaveBeenCalledTimes(2);
  });
});
