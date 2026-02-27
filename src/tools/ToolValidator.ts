import type { ToolDefinition, ToolCall, ToolParameter, ActivityTier } from '../core/types';
import { ToolError } from '../core/errors';

export class ToolValidator {
  /**
   * Validates a tool call against its definition and the character's current state.
   * Performs type coercion (string→number, etc.) and constraint validation.
   * Mutates call.arguments in-place to coerce types.
   */
  validate(
    call: ToolCall,
    availableTools: ToolDefinition[],
    characterTier: ActivityTier,
    characterCloseness: number,
  ): ToolDefinition {
    const tool = availableTools.find(t => t.name === call.toolName);
    if (!tool) {
      throw new ToolError(`Unknown tool: ${call.toolName}`, call.toolName);
    }

    // Check tier requirement
    if (tool.requiredTier) {
      const tierRank: Record<ActivityTier, number> = { active: 2, background: 1, dormant: 0 };
      if (tierRank[characterTier] < tierRank[tool.requiredTier]) {
        throw new ToolError(
          `Tool ${call.toolName} requires ${tool.requiredTier} tier, character is ${characterTier}`,
          call.toolName,
        );
      }
    }

    // Check closeness requirement
    if (tool.minCloseness !== undefined && characterCloseness < tool.minCloseness) {
      throw new ToolError(
        `Tool ${call.toolName} requires closeness >= ${tool.minCloseness}, current: ${characterCloseness}`,
        call.toolName,
      );
    }

    // Validate required parameters
    for (const param of tool.parameters) {
      if (param.required !== false && !(param.name in call.arguments)) {
        // Apply default if available
        if (param.default !== undefined) {
          call.arguments[param.name] = param.default;
        } else {
          throw new ToolError(
            `Missing required parameter '${param.name}' for tool ${call.toolName}`,
            call.toolName,
          );
        }
      }
    }

    // Validate and coerce each parameter
    for (const [key, value] of Object.entries(call.arguments)) {
      const param = tool.parameters.find(p => p.name === key);
      if (!param) continue; // Ignore extra params from LLM

      // Type coercion + validation
      call.arguments[key] = this.validateParam(param, value, call.toolName);
    }

    return tool;
  }

  /**
   * Validate and coerce a single parameter value.
   * LLMs often produce strings where numbers are expected, etc.
   */
  private validateParam(param: ToolParameter, value: unknown, toolName: string): unknown {
    // Null/undefined check
    if (value === null || value === undefined) {
      if (param.required === false) return param.default ?? null;
      throw new ToolError(
        `Parameter '${param.name}' cannot be null`,
        toolName,
      );
    }

    switch (param.type) {
      case 'string':
        return this.validateString(param, value, toolName);
      case 'number':
        return this.validateNumber(param, value, toolName);
      case 'boolean':
        return this.validateBoolean(param, value, toolName);
      case 'array':
        return this.validateArray(param, value, toolName);
      case 'object':
        // Objects pass through — no deep validation
        if (typeof value !== 'object' || Array.isArray(value)) {
          throw new ToolError(
            `Parameter '${param.name}' must be object, got ${typeof value}`,
            toolName,
          );
        }
        return value;
      default:
        return value;
    }
  }

  private validateString(param: ToolParameter, value: unknown, toolName: string): string {
    // Coerce numbers/booleans to string
    const str = typeof value === 'string' ? value
      : (typeof value === 'number' || typeof value === 'boolean') ? String(value)
      : null;

    if (str === null) {
      throw new ToolError(
        `Parameter '${param.name}' must be string, got ${typeof value}`,
        toolName,
      );
    }

    // Length constraint
    if (param.maxLength !== undefined && str.length > param.maxLength) {
      // Truncate rather than reject — LLMs are verbose
      return str.slice(0, param.maxLength);
    }

    // Enum constraint
    if (param.enum && !param.enum.includes(str)) {
      throw new ToolError(
        `Parameter '${param.name}' must be one of: ${param.enum.join(', ')}`,
        toolName,
      );
    }

    return str;
  }

  private validateNumber(param: ToolParameter, value: unknown, toolName: string): number {
    // Coerce string to number (LLMs often return "5" instead of 5)
    let num: number;
    if (typeof value === 'number') {
      num = value;
    } else if (typeof value === 'string') {
      num = Number(value);
      if (isNaN(num)) {
        throw new ToolError(
          `Parameter '${param.name}' must be number, got non-numeric string "${value}"`,
          toolName,
        );
      }
    } else if (typeof value === 'boolean') {
      num = value ? 1 : 0;
    } else {
      throw new ToolError(
        `Parameter '${param.name}' must be number, got ${typeof value}`,
        toolName,
      );
    }

    // Range constraints — clamp rather than reject
    if (param.min !== undefined && num < param.min) num = param.min;
    if (param.max !== undefined && num > param.max) num = param.max;

    // NaN/Infinity check
    if (!isFinite(num)) {
      throw new ToolError(
        `Parameter '${param.name}' must be a finite number`,
        toolName,
      );
    }

    return num;
  }

  private validateBoolean(param: ToolParameter, value: unknown, toolName: string): boolean {
    if (typeof value === 'boolean') return value;
    // Coerce common string representations
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === 'yes' || lower === '1') return true;
      if (lower === 'false' || lower === 'no' || lower === '0') return false;
    }
    if (typeof value === 'number') return value !== 0;

    throw new ToolError(
      `Parameter '${param.name}' must be boolean, got ${typeof value}`,
      toolName,
    );
  }

  private validateArray(param: ToolParameter, value: unknown, toolName: string): unknown[] {
    if (!Array.isArray(value)) {
      // Try to coerce string to array (LLMs sometimes return "a,b,c")
      if (typeof value === 'string') {
        return this.validateArray(param, value.split(',').map(s => s.trim()), toolName);
      }
      throw new ToolError(
        `Parameter '${param.name}' must be array, got ${typeof value}`,
        toolName,
      );
    }

    // Size constraint
    if (param.maxItems !== undefined && value.length > param.maxItems) {
      return value.slice(0, param.maxItems);
    }

    return value;
  }
}
