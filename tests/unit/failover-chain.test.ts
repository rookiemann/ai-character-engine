import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FailoverChain } from '../../src/inference/FailoverChain';
import { InferenceError } from '../../src/core/errors';
import type { InferenceRequest, InferenceResponse, ProviderConfig } from '../../src/core/types';

// We can't easily mock the internal createProvider, so we'll test through the public API
// by adding real provider configs that will fail in test (no server running)

// Instead, let's test the circuit breaker logic by subclassing or using the chain with providers
// that we control via mocking at the network level.

// Since FailoverChain.addProvider creates real providers, we need a different approach.
// Let's test the public API behavior through integration-style tests.

function makeRequest(): InferenceRequest {
  return {
    messages: [{ role: 'user', content: 'test' }],
    tier: 'light',
  };
}

describe('FailoverChain', () => {
  let chain: FailoverChain;

  beforeEach(() => {
    chain = new FailoverChain();
  });

  it('should throw InferenceError when chain is empty', async () => {
    await expect(chain.complete(makeRequest())).rejects.toThrow(InferenceError);
    await expect(chain.complete(makeRequest())).rejects.toThrow('No providers');
  });

  it('should report length of providers', () => {
    expect(chain.length).toBe(0);
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9999/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
    });
    expect(chain.length).toBe(1);
  });

  it('should return status for all providers', () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9999/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
    });
    const status = chain.getStatus();
    expect(status.length).toBe(1);
    expect(status[0].state).toBe('closed');
    expect(status[0].failures).toBe(0);
  });

  it('should return primary provider name when available', () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9999/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
    });
    expect(chain.getPrimary()).toBe('lmstudio');
  });

  it('should return null primary when no providers', () => {
    expect(chain.getPrimary()).toBeNull();
  });

  it('should fall through to next provider on failure', async () => {
    // Add two providers - both will fail since no server, but we test fallthrough behavior
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9998/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
      timeoutMs: 1000,
    });
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9999/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
      timeoutMs: 1000,
    });

    // Both fail, so we get "All providers failed"
    await expect(chain.complete(makeRequest())).rejects.toThrow('All providers failed');
    // After 2 failures, circuit should open
    const status = chain.getStatus();
    // Each provider failed once, need 2 failures to open
    expect(status[0].failures).toBeGreaterThanOrEqual(1);
  });

  it('should open circuit after 2 consecutive failures', async () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9998/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
      timeoutMs: 1000,
    });

    // Fail twice
    await chain.complete(makeRequest()).catch(() => {});
    await chain.complete(makeRequest()).catch(() => {});

    const status = chain.getStatus();
    expect(status[0].failures).toBeGreaterThanOrEqual(2);
    expect(status[0].state).toBe('open');
  });

  it('should have initial cooldown of 5000ms', () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9998/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
    });
    const status = chain.getStatus();
    expect(status[0].cooldownMs).toBe(5000);
  });

  it('should increase cooldown exponentially on repeated failures', async () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9998/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
      timeoutMs: 1000,
    });

    // Fail enough to open circuit and increase cooldown
    for (let i = 0; i < 4; i++) {
      await chain.complete(makeRequest()).catch(() => {});
    }

    const status = chain.getStatus();
    // After multiple failures: 5000 → 10000 → 20000...
    expect(status[0].cooldownMs).toBeGreaterThan(5000);
  });

  it('should run health checks on all providers', async () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9998/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
    });

    const results = await chain.healthCheckAll();
    expect(results).toHaveProperty('lmstudio');
    // Will be false since no server running
    expect(results.lmstudio).toBe(false);
  });

  it('should cap cooldown at 120000ms', async () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9998/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
      timeoutMs: 1000,
    });

    // Many failures to max out cooldown
    for (let i = 0; i < 20; i++) {
      await chain.complete(makeRequest()).catch(() => {});
    }

    const status = chain.getStatus();
    expect(status[0].cooldownMs).toBeLessThanOrEqual(120000);
  });

  // --- Circuit breaker state transition ---

  it('should start all providers in closed state', () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9998/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
    });
    chain.addProvider({
      type: 'vllm',
      baseUrl: 'http://localhost:9999/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
    });

    const status = chain.getStatus();
    for (const s of status) {
      expect(s.state).toBe('closed');
    }
  });

  it('should include provider error messages in combined error', async () => {
    chain.addProvider({
      type: 'lmstudio',
      baseUrl: 'http://localhost:9998/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
      timeoutMs: 1000,
    });

    try {
      await chain.complete(makeRequest());
    } catch (err) {
      expect((err as Error).message).toContain('lmstudio');
    }
  });
});
