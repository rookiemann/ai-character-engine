import type {
  InferenceRequest,
  InferenceResponse,
  InferenceTier,
  ProviderConfig,
} from '../core/types';
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
 * InferenceService - Abstraction layer for LLM inference.
 * Routes requests to the appropriate provider by inference tier.
 * Supports batch concurrency for parallel agent calls.
 *
 * This is the most critical file in the inference layer.
 */
export class InferenceService {
  private provider: BaseProvider;
  private log = getLogger('inference');
  private totalRequests = 0;
  private totalTokens = 0;

  constructor(config: ProviderConfig) {
    this.provider = this.createProvider(config);
    this.log.info({ provider: config.type, models: config.models }, 'InferenceService initialized');
  }

  /**
   * Send a single completion request.
   */
  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    this.totalRequests++;
    this.log.debug({
      tier: request.tier,
      messages: request.messages.length,
      tools: request.tools?.length ?? 0,
      characterId: request.characterId,
    }, 'Inference request');

    const response = await this.provider.complete(request);

    this.totalTokens += response.tokensUsed.total;
    this.log.debug({
      model: response.model,
      tokens: response.tokensUsed.total,
      durationMs: response.durationMs,
      hasToolCalls: !!response.toolCalls,
    }, 'Inference response');

    return response;
  }

  /**
   * Send multiple completion requests concurrently.
   * Leverages LM Studio's batch processing capability.
   * Requests are fired in parallel up to the provider's concurrency limit.
   */
  async completeBatch(requests: InferenceRequest[]): Promise<InferenceResponse[]> {
    if (requests.length === 0) return [];

    this.log.info({
      count: requests.length,
      tiers: requests.map(r => r.tier),
    }, 'Batch inference started');

    const startTime = Date.now();

    // Fire all requests concurrently - provider handles its own concurrency limiting
    const results = await Promise.allSettled(
      requests.map(req => this.complete(req)),
    );

    const responses: InferenceResponse[] = [];
    const errors: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        responses.push(result.value);
      } else {
        const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`Request ${i} (${requests[i].characterId ?? 'unknown'}): ${errorMsg}`);
        // Return a fallback idle response for failed requests
        responses.push({
          content: '',
          tokensUsed: { prompt: 0, completion: 0, total: 0 },
          model: 'error',
          durationMs: 0,
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    this.log.info({
      count: requests.length,
      succeeded: requests.length - errors.length,
      failed: errors.length,
      totalDurationMs: totalDuration,
      avgDurationMs: Math.round(totalDuration / requests.length),
    }, 'Batch inference completed');

    if (errors.length > 0) {
      this.log.warn({ errors }, 'Some batch requests failed');
    }

    return responses;
  }

  /**
   * Stream a single completion request. Yields content chunks as they arrive.
   * The final return value is the complete InferenceResponse.
   */
  async *streamComplete(request: InferenceRequest): AsyncGenerator<string, InferenceResponse> {
    this.totalRequests++;
    this.log.debug({
      tier: request.tier,
      messages: request.messages.length,
      streaming: true,
      characterId: request.characterId,
    }, 'Streaming inference request');

    const gen = this.provider.streamComplete(request);
    let result: IteratorResult<string, InferenceResponse>;

    while (true) {
      result = await gen.next();
      if (result.done) break;
      yield result.value;
    }

    const response = result.value;
    this.totalTokens += response.tokensUsed.total;
    return response;
  }

  /**
   * Check if the inference provider is available.
   */
  async healthCheck(): Promise<boolean> {
    return this.provider.healthCheck();
  }

  /**
   * Get usage statistics.
   */
  getStats(): { totalRequests: number; totalTokens: number; provider: string } {
    return {
      totalRequests: this.totalRequests,
      totalTokens: this.totalTokens,
      provider: this.provider.name,
    };
  }

  /**
   * Swap the provider at runtime (e.g., switch from local to cloud).
   */
  setProvider(config: ProviderConfig): void {
    this.provider = this.createProvider(config);
    this.log.info({ provider: config.type }, 'Provider swapped');
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
