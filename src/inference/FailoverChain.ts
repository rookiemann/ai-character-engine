import type { InferenceRequest, InferenceResponse, ProviderConfig } from '../core/types';
import { BaseProvider } from './providers/BaseProvider';
import { LMStudioProvider } from './providers/LMStudioProvider';
import { OpenRouterProvider } from './providers/OpenRouterProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { VLLMProvider } from './providers/VLLMProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { InferenceError } from '../core/errors';
import { getLogger } from '../core/logger';

/**
 * Circuit breaker states:
 * - CLOSED:    Normal operation, requests flow through
 * - OPEN:      Provider known-bad, requests fast-fail (skip provider)
 * - HALF_OPEN: Probe window — allow one request to test recovery
 */
type CircuitState = 'closed' | 'open' | 'half_open';

interface ProviderCircuit {
  provider: BaseProvider;
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  cooldownMs: number;  // Current backoff duration (grows exponentially)
}

const INITIAL_COOLDOWN_MS = 5_000;   // 5s after first failure
const MAX_COOLDOWN_MS = 120_000;     // Cap at 2 minutes
const FAILURE_THRESHOLD = 2;          // Open circuit after 2 consecutive failures
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Provider Failover Chain with Circuit Breaker
 *
 * Automatically falls back to the next provider when one fails.
 * Circuit breaker prevents hammering a known-bad provider.
 */
export class FailoverChain {
  private circuits: ProviderCircuit[] = [];
  private log = getLogger('failover-chain');

  /**
   * Add a provider to the chain.
   */
  addProvider(config: ProviderConfig): void {
    const provider = this.createProvider(config);
    this.circuits.push({
      provider,
      state: 'closed',
      consecutiveFailures: 0,
      lastFailureAt: 0,
      lastSuccessAt: Date.now(),
      cooldownMs: INITIAL_COOLDOWN_MS,
    });
    this.log.info({ provider: provider.name, position: this.circuits.length }, 'Provider added to chain');
  }

  /**
   * Complete a request using the failover chain.
   * Skips open circuits, probes half-open ones, uses closed ones normally.
   */
  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    if (this.circuits.length === 0) {
      throw new InferenceError('No providers in failover chain');
    }

    const errors: string[] = [];

    for (const circuit of this.circuits) {
      const availability = this.getAvailability(circuit);

      if (availability === 'skip') {
        errors.push(`${circuit.provider.name}: circuit open (${Math.round(circuit.cooldownMs / 1000)}s cooldown)`);
        continue;
      }

      try {
        const response = await circuit.provider.complete(request);
        this.recordSuccess(circuit);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${circuit.provider.name}: ${message}`);
        this.recordFailure(circuit);
        this.log.warn(
          { provider: circuit.provider.name, state: circuit.state, failures: circuit.consecutiveFailures, error: message },
          'Provider failed, trying next',
        );
      }
    }

    throw new InferenceError(`All providers failed: ${errors.join('; ')}`);
  }

  /**
   * Run health checks on all providers concurrently with per-provider timeouts.
   */
  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    const checks = this.circuits.map(async circuit => {
      try {
        const healthy = await Promise.race([
          circuit.provider.healthCheck(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS),
          ),
        ]);
        if (healthy) {
          this.recordSuccess(circuit);
        } else {
          this.recordFailure(circuit);
        }
        results[circuit.provider.name] = healthy;
      } catch {
        this.recordFailure(circuit);
        results[circuit.provider.name] = false;
      }
    });

    await Promise.all(checks);
    return results;
  }

  /**
   * Get the primary (first available) provider name.
   */
  getPrimary(): string | null {
    for (const circuit of this.circuits) {
      if (this.getAvailability(circuit) !== 'skip') {
        return circuit.provider.name;
      }
    }
    return null;
  }

  /**
   * Get circuit breaker status for all providers.
   */
  getStatus(): Array<{ name: string; state: CircuitState; failures: number; cooldownMs: number }> {
    return this.circuits.map(c => ({
      name: c.provider.name,
      state: c.state,
      failures: c.consecutiveFailures,
      cooldownMs: c.cooldownMs,
    }));
  }

  get length(): number {
    return this.circuits.length;
  }

  // --- Circuit breaker logic ---

  private getAvailability(circuit: ProviderCircuit): 'use' | 'probe' | 'skip' {
    if (circuit.state === 'closed') return 'use';

    if (circuit.state === 'open') {
      // Check if cooldown has elapsed → transition to half-open
      if (Date.now() - circuit.lastFailureAt >= circuit.cooldownMs) {
        circuit.state = 'half_open';
        this.log.info({ provider: circuit.provider.name }, 'Circuit half-open, allowing probe');
        return 'probe';
      }
      return 'skip';
    }

    // half_open — allow probe
    return 'probe';
  }

  private recordSuccess(circuit: ProviderCircuit): void {
    circuit.state = 'closed';
    circuit.consecutiveFailures = 0;
    circuit.lastSuccessAt = Date.now();
    circuit.cooldownMs = INITIAL_COOLDOWN_MS; // Reset backoff
  }

  private recordFailure(circuit: ProviderCircuit): void {
    circuit.consecutiveFailures++;
    circuit.lastFailureAt = Date.now();

    if (circuit.consecutiveFailures >= FAILURE_THRESHOLD) {
      circuit.state = 'open';
      // Exponential backoff on cooldown: 5s → 10s → 20s → 40s → ... → 120s cap
      circuit.cooldownMs = Math.min(circuit.cooldownMs * 2, MAX_COOLDOWN_MS);
      this.log.warn(
        { provider: circuit.provider.name, failures: circuit.consecutiveFailures, cooldownMs: circuit.cooldownMs },
        'Circuit opened',
      );
    }
  }

  private createProvider(config: ProviderConfig): BaseProvider {
    switch (config.type) {
      case 'lmstudio':
        return new LMStudioProvider(config);
      case 'openrouter':
        return new OpenRouterProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'vllm':
        return new VLLMProvider(config);
      case 'ollama':
        return new OllamaProvider(config);
      default:
        throw new InferenceError(`Unknown provider type: ${config.type}`);
    }
  }
}
