import type { AgentDecisionRequest, AgentDecisionResult } from '../core/types';
import { AgentRunner } from '../agent/AgentRunner';
import { getLogger } from '../core/logger';

/**
 * Batches agent decision calls for concurrent processing.
 * Takes advantage of LM Studio's batch concurrency to run
 * multiple agent calls simultaneously.
 */
export class BatchProcessor {
  private log = getLogger('batch-processor');

  constructor(
    private runner: AgentRunner,
    private batchSize: number = 10,
  ) {}

  /**
   * Process a list of decision requests in batches.
   * Each batch runs concurrently, batches are processed sequentially.
   */
  async processBatches(requests: AgentDecisionRequest[]): Promise<AgentDecisionResult[]> {
    if (requests.length === 0) return [];

    const allResults: AgentDecisionResult[] = [];
    const batches = this.chunk(requests, this.batchSize);

    this.log.info({
      totalRequests: requests.length,
      batchCount: batches.length,
      batchSize: this.batchSize,
    }, 'Processing batches');

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.log.debug({
        batch: i + 1,
        size: batch.length,
        characters: batch.map(r => r.characterId),
      }, 'Processing batch');

      const startTime = Date.now();
      const results = await this.runner.runBatch(batch);
      const duration = Date.now() - startTime;

      this.log.debug({
        batch: i + 1,
        durationMs: duration,
        avgMs: Math.round(duration / batch.length),
      }, 'Batch complete');

      allResults.push(...results);
    }

    return allResults;
  }

  /**
   * Process a single batch (all concurrent).
   */
  async processSingleBatch(requests: AgentDecisionRequest[]): Promise<AgentDecisionResult[]> {
    return this.runner.runBatch(requests);
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
