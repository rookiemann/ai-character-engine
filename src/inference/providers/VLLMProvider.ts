import { BaseProvider } from './BaseProvider';
import type { InferenceRequest, InferenceResponse, ProviderConfig } from '../../core/types';
import { InferenceError, TimeoutError, RateLimitError } from '../../core/errors';
import { toOpenAITools } from '../../tools/ToolDefinition';
import { getLogger } from '../../core/logger';

const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8000;

/**
 * vLLM provider - high-throughput inference via vLLM's continuous batching.
 *
 * Features:
 * - Exponential backoff retry on transient failures (5xx, timeouts, rate limits)
 * - Proper error categorization (TimeoutError, RateLimitError, InferenceError)
 * - Semaphore-based concurrency limiting (no busy-wait)
 * - Robust tool call JSON parsing with per-call error isolation
 */
export class VLLMProvider extends BaseProvider {
  private log = getLogger('vllm-provider');
  private activeRequests = 0;
  private maxConcurrency: number;
  private maxRetries: number;
  private waitQueue: Array<() => void> = [];

  constructor(config: ProviderConfig) {
    super(config);
    this.maxConcurrency = config.maxConcurrency ?? 64;
    this.maxRetries = DEFAULT_MAX_RETRIES;

    if (!config.baseUrl) {
      this.config.baseUrl = 'http://127.0.0.1:8100/v1';
    }
  }

  get name(): string {
    return 'vllm';
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    await this.acquireConcurrencySlot();
    const startTime = Date.now();

    try {
      return await this.executeWithRetry(request, startTime);
    } finally {
      this.releaseConcurrencySlot();
    }
  }

  private async executeWithRetry(
    request: InferenceRequest,
    startTime: number,
  ): Promise<InferenceResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.executeRequest(request, startTime);
      } catch (error) {
        lastError = error as Error;

        // Don't retry non-retriable errors
        if (error instanceof InferenceError && !error.retriable) {
          throw error;
        }

        // Don't retry if we've exhausted attempts
        if (attempt >= this.maxRetries) break;

        // Calculate backoff
        let delayMs: number;
        if (error instanceof RateLimitError && error.retryAfterMs) {
          delayMs = error.retryAfterMs;
        } else {
          delayMs = Math.min(RETRY_BASE_MS * Math.pow(2, attempt), RETRY_MAX_MS);
          // Add jitter: ±25%
          delayMs += delayMs * (Math.random() * 0.5 - 0.25);
        }

        this.log.warn(
          { attempt: attempt + 1, maxRetries: this.maxRetries, delayMs: Math.round(delayMs), error: lastError.message },
          'Retrying after transient failure',
        );

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError!;
  }

  private async executeRequest(
    request: InferenceRequest,
    startTime: number,
  ): Promise<InferenceResponse> {
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

    if (request.tools && request.tools.length > 0) {
      body.tools = toOpenAITools(request.tools);
      body.tool_choice = 'auto';
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60000),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('abort') || msg.includes('timeout') || msg.includes('Timeout')) {
        throw new TimeoutError(`vLLM request timed out after ${this.config.timeoutMs ?? 60000}ms`, 'vllm');
      }
      throw new InferenceError(`vLLM connection failed: ${msg}`, 'vllm', 0);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(unreadable)');
      const status = response.status;

      if (status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
        throw new RateLimitError(`vLLM rate limited: ${errorText}`, 'vllm', retryMs);
      }

      throw new InferenceError(
        `vLLM returned ${status}: ${errorText}`,
        'vllm',
        status,
      );
    }

    const data = await response.json() as OpenAIResponse;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new InferenceError('No choices in vLLM response', 'vllm');
    }

    const durationMs = Date.now() - startTime;

    // Parse tool calls — isolate per-call failures so one bad parse doesn't kill all
    const rawToolCalls = choice.message?.tool_calls;
    let toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }> | undefined;
    if (rawToolCalls && rawToolCalls.length > 0) {
      toolCalls = [];
      for (const tc of rawToolCalls) {
        try {
          const args = typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
          toolCalls.push({ toolName: tc.function.name, arguments: args });
        } catch (parseErr) {
          this.log.warn(
            { toolName: tc.function.name, raw: tc.function.arguments },
            'Failed to parse tool call arguments — skipping',
          );
        }
      }
      if (toolCalls.length === 0) toolCalls = undefined;
    }

    return {
      content: choice.message?.content ?? '',
      toolCalls,
      tokensUsed: {
        prompt: data.usage?.prompt_tokens ?? 0,
        completion: data.usage?.completion_tokens ?? 0,
        total: data.usage?.total_tokens ?? 0,
      },
      model,
      durationMs,
    };
  }

  // --- Semaphore-based concurrency control (no busy-wait) ---

  private async acquireConcurrencySlot(): Promise<void> {
    if (this.activeRequests < this.maxConcurrency) {
      this.activeRequests++;
      return;
    }
    // Wait in queue until a slot opens
    return new Promise(resolve => {
      this.waitQueue.push(() => {
        this.activeRequests++;
        resolve();
      });
    });
  }

  private releaseConcurrencySlot(): void {
    this.activeRequests--;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    }
  }

  /**
   * Stream a completion. Yields content chunks via SSE.
   * Returns the final InferenceResponse with full content and token counts.
   */
  async *streamComplete(request: InferenceRequest): AsyncGenerator<string, InferenceResponse> {
    await this.acquireConcurrencySlot();
    const startTime = Date.now();

    try {
      const model = this.getModel(request.tier);
      const body: Record<string, unknown> = {
        model,
        messages: request.messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: request.maxTokens ?? 200,
        temperature: request.temperature ?? 0.7,
        stream: true,
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = toOpenAITools(request.tools);
        body.tool_choice = 'auto';
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60000),
      });

      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '(unreadable)');
        throw new InferenceError(`vLLM stream failed ${response.status}: ${errText}`, 'vllm', response.status);
      }

      let fullContent = '';
      let toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }> | undefined;
      let promptTokens = 0;
      let completionTokens = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              yield delta.content;
            }
            // Accumulate tool call deltas
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name || tc.function?.arguments) {
                  if (!toolCalls) toolCalls = [];
                  // Tool calls build up incrementally in SSE
                  const idx = tc.index ?? 0;
                  if (!toolCalls[idx]) {
                    toolCalls[idx] = { toolName: '', arguments: {} };
                  }
                  if (tc.function.name) toolCalls[idx].toolName = tc.function.name;
                  if (tc.function.arguments) {
                    // Arguments come as string fragments — accumulate
                    const existing = (toolCalls[idx] as any)._rawArgs ?? '';
                    (toolCalls[idx] as any)._rawArgs = existing + tc.function.arguments;
                  }
                }
              }
            }
            // Capture usage from final chunk
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? 0;
              completionTokens = chunk.usage.completion_tokens ?? 0;
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }

      // Parse accumulated tool call arguments
      if (toolCalls) {
        for (const tc of toolCalls) {
          const raw = (tc as any)._rawArgs;
          if (raw) {
            try { tc.arguments = JSON.parse(raw); } catch { /* leave empty */ }
            delete (tc as any)._rawArgs;
          }
        }
        toolCalls = toolCalls.filter(tc => tc.toolName);
        if (toolCalls.length === 0) toolCalls = undefined;
      }

      return {
        content: fullContent,
        toolCalls,
        tokensUsed: {
          prompt: promptTokens,
          completion: completionTokens,
          total: promptTokens + completionTokens,
        },
        model,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.releaseConcurrencySlot();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const baseWithoutV1 = this.config.baseUrl!.replace(/\/v1\/?$/, '');
      const response = await fetch(`${baseWithoutV1}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return true;

      const modelsResponse = await fetch(`${this.config.baseUrl}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      return modelsResponse.ok;
    } catch {
      return false;
    }
  }

  get concurrencyInfo(): { active: number; max: number; queued: number } {
    return { active: this.activeRequests, max: this.maxConcurrency, queued: this.waitQueue.length };
  }
}

// OpenAI-compatible response types
interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
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
