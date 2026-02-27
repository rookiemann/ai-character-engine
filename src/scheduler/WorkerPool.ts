import type { AgentDecisionRequest, AgentDecisionResult, InferenceTier } from '../core/types';
import { getLogger } from '../core/logger';

/**
 * Expansion 17: Distributed Tick Processing
 *
 * Worker pool for distributing agent decisions across processing lanes.
 * Uses concurrent promise lanes (not actual threads) to parallelize
 * agent processing beyond the batch processor's sequential batching.
 *
 * For true multi-threading, this can be extended with worker_threads.
 */
export class WorkerPool {
  private lanes: ProcessingLane[];
  private log = getLogger('worker-pool');
  private totalProcessed = 0;

  constructor(
    private laneCount: number = 4,
    private processor: (request: AgentDecisionRequest) => Promise<AgentDecisionResult>,
  ) {
    this.lanes = Array.from({ length: laneCount }, (_, i) => ({
      id: i,
      busy: false,
      processed: 0,
      queue: [],
    }));
  }

  /**
   * Submit a batch of requests for distributed processing.
   * Distributes across lanes by round-robin.
   */
  async processBatch(requests: AgentDecisionRequest[]): Promise<AgentDecisionResult[]> {
    if (requests.length === 0) return [];

    // Distribute requests across lanes
    for (let i = 0; i < requests.length; i++) {
      const lane = this.lanes[i % this.laneCount];
      lane.queue.push(requests[i]);
    }

    // Process all lanes concurrently
    const laneResults = await Promise.all(
      this.lanes.map(lane => this.processLane(lane)),
    );

    // Flatten and reorder to match input order
    const resultMap = new Map<string, AgentDecisionResult>();
    for (const results of laneResults) {
      for (const result of results) {
        resultMap.set(result.characterId, result);
      }
    }

    const ordered = requests.map(req => {
      const result = resultMap.get(req.characterId);
      if (result) return result;
      // Fallback for missing results
      return {
        characterId: req.characterId,
        action: { type: 'idle' as const, thought: 'Processing failed' },
        tokensUsed: 0,
        inferenceTier: 'light' as InferenceTier,
        durationMs: 0,
      };
    });

    this.totalProcessed += requests.length;
    return ordered;
  }

  /**
   * Get pool statistics.
   */
  getStats(): {
    lanes: number;
    totalProcessed: number;
    laneStats: Array<{ id: number; processed: number; queueSize: number }>;
  } {
    return {
      lanes: this.laneCount,
      totalProcessed: this.totalProcessed,
      laneStats: this.lanes.map(l => ({
        id: l.id,
        processed: l.processed,
        queueSize: l.queue.length,
      })),
    };
  }

  private async processLane(lane: ProcessingLane): Promise<AgentDecisionResult[]> {
    const results: AgentDecisionResult[] = [];
    const requests = lane.queue.splice(0);

    if (requests.length === 0) return results;

    lane.busy = true;

    // Process requests in this lane concurrently
    const settled = await Promise.allSettled(
      requests.map(req => this.processor(req)),
    );

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          characterId: requests[i].characterId,
          action: { type: 'idle' as const, thought: 'Lane processing failed' },
          tokensUsed: 0,
          inferenceTier: 'light' as InferenceTier,
          durationMs: 0,
        });
      }
    }

    lane.processed += requests.length;
    lane.busy = false;
    return results;
  }
}

interface ProcessingLane {
  id: number;
  busy: boolean;
  processed: number;
  queue: AgentDecisionRequest[];
}
