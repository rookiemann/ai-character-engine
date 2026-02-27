import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchProcessor } from '../../src/scheduler/BatchProcessor';
import type { AgentDecisionRequest, AgentDecisionResult } from '../../src/core/types';

function makeResult(charId: string): AgentDecisionResult {
  return {
    characterId: charId,
    action: { type: 'idle' },
    tokensUsed: 50,
    inferenceTier: 'mid',
    durationMs: 100,
  };
}

function makeReq(charId: string): AgentDecisionRequest {
  return {
    characterId: charId,
    playerId: 'default',
    gameState: { worldTime: Date.now() },
    proprioception: {},
    availableTools: [],
    energyLevel: 0.5,
  };
}

describe('BatchProcessor', () => {
  let processor: BatchProcessor;
  let mockRunner: any;

  beforeEach(() => {
    mockRunner = {
      runBatch: vi.fn().mockImplementation(async (requests: AgentDecisionRequest[]) => {
        return requests.map(r => makeResult(r.characterId));
      }),
    };
    processor = new BatchProcessor(mockRunner, 3);
  });

  it('should process all requests in chunks of batchSize', async () => {
    const requests = [makeReq('c1'), makeReq('c2'), makeReq('c3'), makeReq('c4'), makeReq('c5')];
    const results = await processor.processBatches(requests);
    expect(results).toHaveLength(5);
    // With batchSize=3: 2 batches (3 + 2)
    expect(mockRunner.runBatch).toHaveBeenCalledTimes(2);
  });

  it('should process batches sequentially', async () => {
    const callOrder: number[] = [];
    let callIdx = 0;
    mockRunner.runBatch.mockImplementation(async (requests: any[]) => {
      callOrder.push(++callIdx);
      return requests.map((r: any) => makeResult(r.characterId));
    });

    const requests = [makeReq('c1'), makeReq('c2'), makeReq('c3'), makeReq('c4')];
    await processor.processBatches(requests);
    expect(callOrder).toEqual([1, 2]);
  });

  it('should return results in order', async () => {
    const requests = [makeReq('c1'), makeReq('c2'), makeReq('c3')];
    const results = await processor.processBatches(requests);
    expect(results[0].characterId).toBe('c1');
    expect(results[1].characterId).toBe('c2');
    expect(results[2].characterId).toBe('c3');
  });

  it('should handle empty request list', async () => {
    const results = await processor.processBatches([]);
    expect(results).toEqual([]);
    expect(mockRunner.runBatch).not.toHaveBeenCalled();
  });

  it('should delegate processSingleBatch to runner', async () => {
    const requests = [makeReq('c1'), makeReq('c2')];
    const results = await processor.processSingleBatch(requests);
    expect(results).toHaveLength(2);
    expect(mockRunner.runBatch).toHaveBeenCalledTimes(1);
  });

  it('should handle non-divisible chunk count', async () => {
    const requests = [makeReq('c1'), makeReq('c2'), makeReq('c3'), makeReq('c4')];
    // batchSize=3: chunks of [3, 1]
    const results = await processor.processBatches(requests);
    expect(results).toHaveLength(4);
    expect(mockRunner.runBatch).toHaveBeenCalledTimes(2);
    // First batch had 3 items
    expect(mockRunner.runBatch.mock.calls[0][0]).toHaveLength(3);
    // Second batch had 1 item
    expect(mockRunner.runBatch.mock.calls[1][0]).toHaveLength(1);
  });

  // --- Concurrency behavior (continuous batching) ---

  it('should run all agents within a batch concurrently', async () => {
    // Verify that runBatch receives all requests at once (not one at a time)
    // This is what enables vLLM/LM Studio/Ollama continuous batching:
    // all requests hit the server simultaneously, get batched into one GPU pass
    const receivedBatchSizes: number[] = [];
    mockRunner.runBatch.mockImplementation(async (requests: any[]) => {
      receivedBatchSizes.push(requests.length);
      return requests.map((r: any) => makeResult(r.characterId));
    });

    const requests = Array.from({ length: 10 }, (_, i) => makeReq(`c${i}`));
    const bigBatch = new BatchProcessor(mockRunner, 10);
    await bigBatch.processBatches(requests);

    // All 10 agents sent in a single batch → single call to runBatch
    expect(receivedBatchSizes).toEqual([10]);
    expect(mockRunner.runBatch).toHaveBeenCalledTimes(1);
  });

  it('should handle partial batch failure gracefully', async () => {
    // In continuous batching, one agent failing shouldn't crash the others
    mockRunner.runBatch.mockImplementation(async (requests: any[]) => {
      return requests.map((r: any) => {
        if (r.characterId === 'c2') {
          return { ...makeResult('c2'), action: { type: 'idle', thought: 'Decision failed' } };
        }
        return makeResult(r.characterId);
      });
    });

    const requests = [makeReq('c1'), makeReq('c2'), makeReq('c3')];
    const results = await processor.processSingleBatch(requests);

    expect(results).toHaveLength(3);
    expect(results[0].characterId).toBe('c1');
    expect(results[1].action.type).toBe('idle'); // Failed agent gets idle
    expect(results[2].characterId).toBe('c3');
  });

  it('should pass correct character IDs in each batch chunk', async () => {
    const batchCharIds: string[][] = [];
    mockRunner.runBatch.mockImplementation(async (requests: any[]) => {
      batchCharIds.push(requests.map((r: any) => r.characterId));
      return requests.map((r: any) => makeResult(r.characterId));
    });

    const requests = Array.from({ length: 7 }, (_, i) => makeReq(`c${i}`));
    await processor.processBatches(requests); // batchSize=3: [3, 3, 1]

    expect(batchCharIds).toEqual([
      ['c0', 'c1', 'c2'],
      ['c3', 'c4', 'c5'],
      ['c6'],
    ]);
  });
});
