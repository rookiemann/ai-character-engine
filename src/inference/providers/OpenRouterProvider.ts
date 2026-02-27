import { BaseProvider } from './BaseProvider';
import type { InferenceRequest, InferenceResponse, ProviderConfig } from '../../core/types';
import { InferenceError } from '../../core/errors';
import { toOpenAITools } from '../../tools/ToolDefinition';
import { getLogger } from '../../core/logger';

/**
 * OpenRouter provider - routes to various models via OpenRouter API.
 * Uses OpenAI-compatible format.
 */
export class OpenRouterProvider extends BaseProvider {
  private log = getLogger('openrouter-provider');
  private activeRequests = 0;
  private maxConcurrency: number;

  constructor(config: ProviderConfig) {
    super(config);
    this.maxConcurrency = config.maxConcurrency ?? 20;
    if (!config.baseUrl) {
      this.config.baseUrl = 'https://openrouter.ai/api/v1';
    }
  }

  get name(): string {
    return 'openrouter';
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    while (this.activeRequests >= this.maxConcurrency) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.activeRequests++;
    const startTime = Date.now();

    try {
      const model = this.getModel(request.tier);
      const body: Record<string, unknown> = {
        model,
        messages: request.messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: request.maxTokens ?? 200,
        temperature: request.temperature ?? 0.7,
        stream: false,
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = toOpenAITools(request.tools);
        body.tool_choice = 'auto';
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'HTTP-Referer': 'https://ai-character-engine.local',
          'X-Title': 'AI Character Engine',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new InferenceError(`OpenRouter returned ${response.status}: ${errorText}`, 'openrouter');
      }

      const data = await response.json() as any;
      const choice = data.choices?.[0];

      if (!choice) {
        throw new InferenceError('No choices in OpenRouter response', 'openrouter');
      }

      const toolCalls = choice.message?.tool_calls?.map((tc: any) => ({
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
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof InferenceError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new InferenceError(`OpenRouter request failed: ${message}`, 'openrouter');
    } finally {
      this.activeRequests--;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
