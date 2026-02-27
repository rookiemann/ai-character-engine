import type { InferenceRequest, InferenceResponse, InferenceTier, ProviderConfig } from '../../core/types';

/**
 * Abstract provider interface for LLM inference.
 * All providers must implement this interface.
 * Supports round-robin model pools per tier via modelsPool config.
 */
export abstract class BaseProvider {
  private roundRobinCounters = new Map<InferenceTier, number>();

  constructor(protected config: ProviderConfig) {}

  /**
   * Get the model name for the given inference tier.
   * If modelsPool is configured for this tier, round-robins across the pool.
   */
  getModel(tier: InferenceTier): string {
    const pool = this.config.modelsPool?.[tier];
    if (pool && pool.length > 0) {
      const counter = this.roundRobinCounters.get(tier) ?? 0;
      const model = pool[counter % pool.length];
      this.roundRobinCounters.set(tier, counter + 1);
      return model;
    }
    return this.config.models[tier];
  }

  /**
   * Send a completion request to the LLM.
   */
  abstract complete(request: InferenceRequest): Promise<InferenceResponse>;

  /**
   * Stream a completion request. Yields content chunks as they arrive.
   * Default implementation falls back to non-streaming complete().
   * Providers override this for true SSE streaming.
   */
  async *streamComplete(request: InferenceRequest): AsyncGenerator<string, InferenceResponse> {
    const response = await this.complete(request);
    if (response.content) yield response.content;
    return response;
  }

  /**
   * Check if the provider is available/reachable.
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Provider identifier.
   */
  abstract get name(): string;
}
