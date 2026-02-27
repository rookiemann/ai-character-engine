import type { ToolDefinition, ToolParameter, ToolCall } from '../core/types';

/**
 * Converts engine ToolDefinition to OpenAI function-calling format
 * for LLM consumption.
 */
export function toOpenAIFunction(tool: ToolDefinition): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
      ...(param.enum ? { enum: param.enum } : {}),
      ...(param.default !== undefined ? { default: param.default } : {}),
    };

    if (param.required !== false) {
      required.push(param.name);
    }
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  };
}

/**
 * Converts a list of engine tools to OpenAI tools array.
 */
export function toOpenAITools(tools: ToolDefinition[]): object[] {
  return tools.map(toOpenAIFunction);
}
