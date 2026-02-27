import type { ToolCall, ToolResult, ActivityTier, GameEvent, ToolExecutionContext, ToolDefinition } from '../core/types';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolValidator } from '../tools/ToolValidator';
import { getLogger } from '../core/logger';

/**
 * Validates and executes tool calls from LLM responses.
 * Routes through ToolRegistry which delegates to game plugin executors.
 */
export class ToolExecutor {
  private log = getLogger('tool-executor');

  constructor(private registry: ToolRegistry) {}

  /**
   * Execute a tool call, returning the result and any side effects.
   * Optionally accepts a ToolExecutionContext for context-rich execution.
   */
  async execute(
    call: ToolCall,
    characterId: string,
    tier: ActivityTier,
    closeness: number,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    this.log.debug({
      tool: call.toolName,
      characterId,
      tier,
      args: call.arguments,
    }, 'Executing tool');

    const result = await this.registry.execute(call, characterId, tier, closeness, context);

    this.log.debug({
      tool: call.toolName,
      characterId,
      success: result.success,
      sideEffects: result.sideEffects?.length ?? 0,
    }, 'Tool result');

    return result;
  }

  /**
   * Parse tool calls from LLM response content (fallback for models
   * that don't support native function calling).
   *
   * 6-stage pipeline:
   *   1. <tool_call> XML tags
   *   2. JSON code blocks
   *   3. Inline JSON with tool/name/action key
   *   4. Function-call-as-text: tool_name(arg: "val")
   *   5. Argument-shape matching: {"location": "x"} → infer tool from param names
   */
  parseToolCallFromText(text: string): ToolCall | null {
    // Strip [assistant] prefix that some models add
    const cleaned = text.replace(/^\[assistant\]\s*/i, '').trim();

    // Stage 1: <tool_call> tags (Qwen2.5 native format)
    const toolCallTagMatch = cleaned.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
    if (toolCallTagMatch) {
      try {
        const parsed = JSON.parse(toolCallTagMatch[1]);
        if (parsed.name && parsed.arguments) {
          return { toolName: parsed.name, arguments: parsed.arguments };
        }
        if (parsed.tool && parsed.arguments) {
          return { toolName: parsed.tool, arguments: parsed.arguments };
        }
      } catch { /* Not valid JSON */ }
    }

    // Stage 1b: OpenAI-style function call array — [{"type":"function","function":"name","arguments":{}}]
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const first = parsed[0];
          // OpenAI format: {"type":"function","function":"tool_name","arguments":{...}}
          if (first.function && typeof first.function === 'string') {
            return { toolName: first.function, arguments: first.arguments ?? {} };
          }
          // Variant: {"type":"function","function":{"name":"tool_name","arguments":{...}}}
          if (first.function && typeof first.function === 'object' && first.function.name) {
            return { toolName: first.function.name, arguments: first.function.arguments ?? {} };
          }
          // Simple array of tool calls: [{"name":"tool","arguments":{}}]
          if (first.name && first.arguments) {
            return { toolName: first.name, arguments: first.arguments };
          }
          if (first.tool && first.arguments) {
            return { toolName: first.tool, arguments: first.arguments };
          }
        }
      } catch { /* Not valid JSON array */ }
    }

    // Stage 2: JSON code blocks
    const jsonMatch = cleaned.match(/```(?:json)?\s*\n?({[\s\S]*?})\n?```/);
    if (jsonMatch) {
      const result = this.tryParseToolJson(jsonMatch[1]);
      if (result) return result;
    }

    // Stage 3: Inline JSON with tool/name/action key
    const inlineMatch = cleaned.match(/\{[^{}]*"(?:tool|name|action)"\s*:\s*"[^"]+"\s*[,}]/);
    if (inlineMatch) {
      try {
        const start = cleaned.indexOf(inlineMatch[0]);
        let depth = 0;
        let end = start;
        for (let i = start; i < cleaned.length; i++) {
          if (cleaned[i] === '{') depth++;
          if (cleaned[i] === '}') depth--;
          if (depth === 0) { end = i + 1; break; }
        }
        const result = this.tryParseToolJson(cleaned.slice(start, end));
        if (result) return result;
      } catch { /* Not valid JSON */ }
    }

    // Stage 4: Function-call-as-text — tool_name(key: "value", ...)
    const funcMatch = cleaned.match(/(\w+)\s*\(\s*(.*?)\s*\)/s);
    if (funcMatch) {
      const funcName = funcMatch[1];
      const tool = this.registry.getDefinition(funcName);
      if (tool) {
        const args = this.parseFuncArgs(funcMatch[2]);
        return { toolName: funcName, arguments: args };
      }
    }

    // Stage 5: Argument-shape matching — JSON without tool key
    const jsonObjMatch = cleaned.match(/\{[^{}]+\}/);
    if (jsonObjMatch) {
      try {
        const parsed = JSON.parse(jsonObjMatch[0]);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const matched = this.matchToolByArgs(parsed);
          if (matched) return matched;
        }
      } catch {
        // Try with fuzzy fixes (single quotes, unquoted keys)
        let candidate = jsonObjMatch[0];
        candidate = candidate.replace(/'/g, '"');
        candidate = candidate.replace(/,\s*}/g, '}');
        candidate = candidate.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
        try {
          const parsed = JSON.parse(candidate);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const matched = this.matchToolByArgs(parsed);
            if (matched) return matched;
          }
        } catch { /* give up */ }
      }
    }

    return null;
  }

  /**
   * Try to parse a JSON string as a tool call with standard key names.
   */
  private tryParseToolJson(json: string): ToolCall | null {
    try {
      const parsed = JSON.parse(json);
      if (parsed.tool) return { toolName: parsed.tool, arguments: parsed.arguments ?? {} };
      if (parsed.name) return { toolName: parsed.name, arguments: parsed.arguments ?? parsed.params ?? {} };
      if (parsed.action) return { toolName: parsed.action, arguments: parsed.params ?? parsed.arguments ?? {} };
    } catch { /* Not valid */ }
    return null;
  }

  /**
   * Parse function-call-style arguments: key: "value", key2: "value2"
   */
  private parseFuncArgs(argsStr: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    if (!argsStr.trim()) return args;

    // Match key: "value" or key: value patterns
    const matches = argsStr.matchAll(/(\w+)\s*[:=]\s*(?:"([^"]*?)"|'([^']*?)'|(\S+))/g);
    for (const m of matches) {
      args[m[1]] = m[2] ?? m[3] ?? m[4];
    }
    return args;
  }

  /**
   * Match a JSON object (without tool key) to a registered tool by
   * comparing its keys against tool parameter names.
   *
   * Example: {"location": "market"} → matches move_to(location) with score 1/1
   */
  private matchToolByArgs(obj: Record<string, unknown>): ToolCall | null {
    const keys = Object.keys(obj);
    if (keys.length === 0) return null;

    const allTools = this.registry.getAllDefinitions();
    let bestTool: ToolDefinition | null = null;
    let bestScore = 0;

    for (const tool of allTools) {
      const paramNames = new Set(tool.parameters.map(p => p.name));
      if (paramNames.size === 0) continue;

      // Count how many of the object's keys match this tool's parameter names
      let matches = 0;
      for (const key of keys) {
        if (paramNames.has(key)) matches++;
      }

      if (matches === 0) continue;

      // Score: proportion of matched keys vs total params (prefer exact matches)
      const score = matches / Math.max(keys.length, paramNames.size);
      if (score > bestScore) {
        bestScore = score;
        bestTool = tool;
      }
    }

    // Require at least 50% match to avoid false positives
    if (bestTool && bestScore >= 0.5) {
      // Extract only the arguments that match the tool's parameters
      const paramNames = new Set(bestTool.parameters.map(p => p.name));
      const args: Record<string, unknown> = {};
      for (const key of keys) {
        if (paramNames.has(key)) args[key] = obj[key];
      }
      this.log.debug({ tool: bestTool.name, score: bestScore, keys }, 'Matched tool by argument shape');
      return { toolName: bestTool.name, arguments: args };
    }

    return null;
  }
}
