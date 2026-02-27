import { BaseProvider } from './BaseProvider';
import type { InferenceRequest, InferenceResponse, ProviderConfig, ToolDefinition } from '../../core/types';
import { InferenceError } from '../../core/errors';
import { toOpenAITools } from '../../tools/ToolDefinition';
import { getLogger } from '../../core/logger';

/**
 * LM Studio provider - OpenAI-compatible local API.
 * Supports batch concurrency for high throughput with many simultaneous agent calls.
 */
export class LMStudioProvider extends BaseProvider {
  private log = getLogger('lmstudio-provider');
  private activeRequests = 0;
  private maxConcurrency: number;

  constructor(config: ProviderConfig) {
    super(config);
    this.maxConcurrency = config.maxConcurrency ?? 10;

    if (!config.baseUrl) {
      this.config.baseUrl = 'http://localhost:1234/v1';
    }
  }

  get name(): string {
    return 'lmstudio';
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    // Wait for concurrency slot
    while (this.activeRequests >= this.maxConcurrency) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.activeRequests++;
    const startTime = Date.now();

    try {
      const model = this.getModel(request.tier);
      const body: Record<string, unknown> = {
        model,
        messages: request.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: request.maxTokens ?? 200,
        temperature: request.temperature ?? 0.7,
        stream: false,
      };

      // Add tools if provided (OpenAI function calling format)
      if (request.tools && request.tools.length > 0) {
        body.tools = toOpenAITools(request.tools);
        body.tool_choice = 'auto';
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new InferenceError(
          `LM Studio returned ${response.status}: ${errorText}`,
          'lmstudio',
        );
      }

      const data = await response.json() as OpenAIResponse;
      const choice = data.choices?.[0];

      if (!choice) {
        throw new InferenceError('No choices in LM Studio response', 'lmstudio');
      }

      const durationMs = Date.now() - startTime;

      // Parse tool calls from response
      const toolCalls = choice.message?.tool_calls?.map(tc => ({
        toolName: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));

      return {
        content: choice.message?.content ?? '',
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        tokensUsed: {
          prompt: data.usage?.prompt_tokens ?? 0,
          completion: data.usage?.completion_tokens ?? 0,
          total: data.usage?.total_tokens ?? 0,
        },
        model,
        durationMs,
      };
    } catch (error) {
      if (error instanceof InferenceError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new InferenceError(`LM Studio request failed: ${message}`, 'lmstudio');
    } finally {
      this.activeRequests--;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get current concurrency utilization.
   */
  get concurrencyInfo(): { active: number; max: number } {
    return { active: this.activeRequests, max: this.maxConcurrency };
  }
}

// OpenAI-compatible response types
interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
