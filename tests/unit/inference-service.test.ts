import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InferenceService } from '../../src/inference/InferenceService';
import type { InferenceRequest, InferenceResponse } from '../../src/core/types';

/**
 * Tests for InferenceService batch concurrency.
 *
 * vLLM, LM Studio, and Ollama all support continuous batching —
 * multiple requests arriving at the same time get batched into a single
 * GPU forward pass. The InferenceService.completeBatch() method fires
 * all requests via Promise.allSettled() so the provider's server-side
 * batching can group them together.
 */

function makeRequest(charId: string, tier: 'mid' | 'low' | 'minimal' = 'mid'): InferenceRequest {
  return {
    messages: [{ role: 'system', content: 'You are an NPC.' }, { role: 'user', content: 'Decide.' }],
    maxTokens: 100,
    temperature: 0.7,
    tier,
    characterId: charId,
  };
}

function makeResponse(model: string = 'test-model'): InferenceResponse {
  return {
    content: 'I will rest.',
    tokensUsed: { prompt: 50, completion: 20, total: 70 },
    model,
    durationMs: 100,
  };
}

describe('InferenceService — batch concurrency', () => {
  let service: InferenceService;
  let mockComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create service with vLLM provider config — we'll mock the internal provider
    service = new InferenceService({
      type: 'vllm',
      models: ['test-model'],
      baseUrl: 'http://localhost:9999/v1', // unused — we mock
    });

    // Replace the internal provider with a mock
    mockComplete = vi.fn().mockResolvedValue(makeResponse());
    (service as any).provider = {
      name: 'mock-provider',
      complete: mockComplete,
      healthCheck: vi.fn().mockResolvedValue(true),
      streamComplete: vi.fn(),
    };
  });

  // --- single complete ---

  it('should complete a single request', async () => {
    const req = makeRequest('c1');
    const res = await service.complete(req);
    expect(res.content).toBe('I will rest.');
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('should track request and token stats', async () => {
    await service.complete(makeRequest('c1'));
    await service.complete(makeRequest('c2'));
    const stats = service.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.totalTokens).toBe(140); // 70 * 2
    expect(stats.provider).toBe('mock-provider');
  });

  // --- completeBatch: concurrent dispatch ---

  it('should fire all batch requests concurrently via Promise.allSettled', async () => {
    const callTimestamps: number[] = [];

    mockComplete.mockImplementation(async () => {
      callTimestamps.push(Date.now());
      // Simulate a 50ms inference call
      await new Promise(r => setTimeout(r, 50));
      return makeResponse();
    });

    const requests = Array.from({ length: 5 }, (_, i) => makeRequest(`c${i}`));
    const results = await service.completeBatch(requests);

    expect(results).toHaveLength(5);
    expect(mockComplete).toHaveBeenCalledTimes(5);

    // All calls should have started within a tight window (concurrent, not sequential)
    // If sequential, total time would be ~250ms; concurrent should be ~50ms
    const spread = Math.max(...callTimestamps) - Math.min(...callTimestamps);
    expect(spread).toBeLessThan(30); // All fired within 30ms of each other
  });

  it('should return results in order matching input requests', async () => {
    mockComplete.mockImplementation(async (req: InferenceRequest) => {
      // Variable delay — character c2 finishes first, c0 last
      const delay = req.characterId === 'c0' ? 80 : req.characterId === 'c2' ? 10 : 40;
      await new Promise(r => setTimeout(r, delay));
      return { ...makeResponse(), content: `Response for ${req.characterId}` };
    });

    const requests = [makeRequest('c0'), makeRequest('c1'), makeRequest('c2')];
    const results = await service.completeBatch(requests);

    // Even though c2 finishes first, results should maintain input order
    expect(results[0].content).toBe('Response for c0');
    expect(results[1].content).toBe('Response for c1');
    expect(results[2].content).toBe('Response for c2');
  });

  it('should handle partial failures — successful requests still return', async () => {
    let callIdx = 0;
    mockComplete.mockImplementation(async () => {
      callIdx++;
      if (callIdx === 2) throw new Error('Provider timeout');
      return makeResponse();
    });

    const requests = [makeRequest('c1'), makeRequest('c2'), makeRequest('c3')];
    const results = await service.completeBatch(requests);

    expect(results).toHaveLength(3);
    // c1 and c3 succeeded
    expect(results[0].content).toBe('I will rest.');
    expect(results[2].content).toBe('I will rest.');
    // c2 failed — should get a fallback empty response
    expect(results[1].content).toBe('');
    expect(results[1].model).toBe('error');
  });

  it('should handle all requests failing', async () => {
    mockComplete.mockRejectedValue(new Error('Server down'));

    const requests = [makeRequest('c1'), makeRequest('c2')];
    const results = await service.completeBatch(requests);

    expect(results).toHaveLength(2);
    expect(results[0].model).toBe('error');
    expect(results[1].model).toBe('error');
  });

  it('should return empty array for empty batch', async () => {
    const results = await service.completeBatch([]);
    expect(results).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('should accumulate tokens across batch requests', async () => {
    const requests = Array.from({ length: 4 }, (_, i) => makeRequest(`c${i}`));
    await service.completeBatch(requests);
    const stats = service.getStats();
    expect(stats.totalRequests).toBe(4);
    expect(stats.totalTokens).toBe(280); // 70 * 4
  });

  // --- batch throughput advantage ---

  it('should complete a batch faster than sequential calls', async () => {
    mockComplete.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 30)); // Simulate 30ms per call
      return makeResponse();
    });

    const requests = Array.from({ length: 8 }, (_, i) => makeRequest(`c${i}`));

    const start = Date.now();
    await service.completeBatch(requests);
    const batchDuration = Date.now() - start;

    // 8 calls at 30ms each sequential = 240ms
    // Concurrent should be ~30-50ms
    // Use generous threshold but prove it's not sequential
    expect(batchDuration).toBeLessThan(150); // Well under 240ms sequential time
  });

  // --- provider swap ---

  it('should use new provider after setProvider', async () => {
    const newMock = vi.fn().mockResolvedValue({
      ...makeResponse('new-model'),
      content: 'New provider response',
    });

    service.setProvider({
      type: 'vllm',
      models: ['new-model'],
      baseUrl: 'http://localhost:9998/v1',
    });

    // Replace the newly created provider with our mock
    (service as any).provider = {
      name: 'new-mock',
      complete: newMock,
      healthCheck: vi.fn().mockResolvedValue(true),
      streamComplete: vi.fn(),
    };

    const res = await service.complete(makeRequest('c1'));
    expect(res.content).toBe('New provider response');
    expect(newMock).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  // --- health check ---

  it('should delegate health check to provider', async () => {
    const result = await service.healthCheck();
    expect(result).toBe(true);
  });
});
