import type { ProviderConfig } from '../core/types';
import { getLogger } from '../core/logger';

/**
 * Optional embedding service for semantic memory retrieval.
 * Used as fallback (~10-15% of cases) when SQL-first retrieval
 * doesn't find relevant results.
 */
export class EmbeddingService {
  private log = getLogger('embeddings');
  private baseUrl: string;

  constructor(private config: ProviderConfig) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:1234/v1';
  }

  /**
   * Generate embeddings for a text string.
   */
  async embed(text: string, model?: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model ?? 'text-embedding-nomic-embed-text-v2-moe@q8_0',
        input: text,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10000),
    });

    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0].embedding;
  }

  /**
   * Generate embeddings for multiple texts in batch.
   */
  async embedBatch(texts: string[], model?: string): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model ?? 'text-embedding-nomic-embed-text-v2-moe@q8_0',
        input: texts,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
    });

    if (!response.ok) {
      throw new Error(`Batch embedding request failed: ${response.status}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map(d => d.embedding);
  }

  /**
   * Compute cosine similarity between two embedding vectors.
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
