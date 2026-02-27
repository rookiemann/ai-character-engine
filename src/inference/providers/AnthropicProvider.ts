import { BaseProvider } from './BaseProvider';
import type { InferenceRequest, InferenceResponse, ProviderConfig, ToolDefinition } from '../../core/types';
import { InferenceError } from '../../core/errors';
import { getLogger } from '../../core/logger';

/**
 * Anthropic provider - Claude API with native tool use.
 */
export class AnthropicProvider extends BaseProvider {
  private log = getLogger('anthropic-provider');
  private activeRequests = 0;
  private maxConcurrency: number;

  constructor(config: ProviderConfig) {
    super(config);
    this.maxConcurrency = config.maxConcurrency ?? 10;
    if (!config.baseUrl) {
      this.config.baseUrl = 'https://api.anthropic.com';
    }
  }

  get name(): string {
    return 'anthropic';
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    while (this.activeRequests >= this.maxConcurrency) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.activeRequests++;
    const startTime = Date.now();

    try {
      const model = this.getModel(request.tier);

      // Convert messages: extract system message
      const systemMsg = request.messages.find(m => m.role === 'system');
      const otherMsgs = request.messages.filter(m => m.role !== 'system');

      const body: Record<string, unknown> = {
        model,
        max_tokens: request.maxTokens ?? 200,
        messages: otherMsgs.map(m => ({ role: m.role, content: m.content })),
      };

      if (systemMsg) {
        body.system = systemMsg.content;
      }

      if (request.temperature !== undefined) {
        body.temperature = request.temperature;
      }

      // Convert tools to Anthropic format
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map(t => this.toAnthropicTool(t));
      }

      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new InferenceError(`Anthropic returned ${response.status}: ${errorText}`, 'anthropic');
      }

      const data = await response.json() as AnthropicResponse;

      // Extract text and tool use from content blocks
      let textContent = '';
      const toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }> = [];

      for (const block of data.content) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            toolName: block.name!,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokensUsed: {
          prompt: data.usage.input_tokens,
          completion: data.usage.output_tokens,
          total: data.usage.input_tokens + data.usage.output_tokens,
        },
        model,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof InferenceError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new InferenceError(`Anthropic request failed: ${message}`, 'anthropic');
    } finally {
      this.activeRequests--;
    }
  }

  async healthCheck(): Promise<boolean> {
    // Anthropic doesn't have a simple health endpoint, so we just check if the API key is set
    return !!this.config.apiKey;
  }

  private toAnthropicTool(tool: ToolDefinition): object {
    const properties: Record<string, object> = {};
    const required: string[] = [];

    for (const param of tool.parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {}),
      };
      if (param.required !== false) {
        required.push(param.name);
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties,
        required,
      },
    };
  }
}

interface AnthropicResponse {
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    name?: string;
    input?: unknown;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: string;
}
