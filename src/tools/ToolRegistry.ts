import type { ToolDefinition, ToolCall, ToolResult, ActivityTier, ToolExecutionContext } from '../core/types';
import { ToolValidator } from './ToolValidator';
import { ToolError } from '../core/errors';
import { getLogger } from '../core/logger';

export type ToolExecutorFn = (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolResult> | ToolResult;

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private executors = new Map<string, ToolExecutorFn>();
  private cooldowns = new Map<string, number>(); // toolName:characterId → last used timestamp
  private validator = new ToolValidator();
  private log = getLogger('tools');

  register(tool: ToolDefinition, executor: ToolExecutorFn): void {
    if (this.tools.has(tool.name)) {
      this.log.warn({ tool: tool.name }, 'Overwriting existing tool registration');
    }
    this.tools.set(tool.name, tool);
    this.executors.set(tool.name, executor);
    this.log.debug({ tool: tool.name }, 'Tool registered');
  }

  unregister(name: string): void {
    this.tools.delete(name);
    this.executors.delete(name);
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools available to a character based on their tier and closeness.
   */
  getAvailableTools(tier: ActivityTier, closeness: number): ToolDefinition[] {
    const tierRank: Record<ActivityTier, number> = { active: 2, background: 1, dormant: 0 };
    const rank = tierRank[tier];

    return Array.from(this.tools.values()).filter(tool => {
      if (tool.requiredTier && tierRank[tool.requiredTier] > rank) return false;
      if (tool.minCloseness !== undefined && closeness < tool.minCloseness) return false;
      return true;
    });
  }

  /**
   * Check if a tool is currently on cooldown for a character.
   */
  isOnCooldown(toolName: string, characterId: string): boolean {
    const tool = this.tools.get(toolName);
    if (!tool?.cooldownMs) return false;
    const key = `${toolName}\0${characterId}`;
    const lastUsed = this.cooldowns.get(key) ?? 0;
    return (Date.now() - lastUsed) < tool.cooldownMs;
  }

  /**
   * Get tools available to a character, filtering out those on cooldown.
   */
  getAvailableToolsFiltered(tier: ActivityTier, closeness: number, characterId: string): ToolDefinition[] {
    return this.getAvailableTools(tier, closeness)
      .filter(t => !this.isOnCooldown(t.name, characterId));
  }

  /**
   * Validate and execute a tool call.
   * Optionally accepts a ToolExecutionContext passed as 2nd arg to executor.
   * 100% backward-compatible — old executors (args) => result ignore the extra argument.
   */
  async execute(
    call: ToolCall,
    characterId: string,
    characterTier: ActivityTier,
    characterCloseness: number,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const availableTools = this.getAvailableTools(characterTier, characterCloseness);
    const tool = this.validator.validate(call, availableTools, characterTier, characterCloseness);

    // Check cooldown
    if (tool.cooldownMs) {
      const cooldownKey = `${tool.name}:${characterId}`;
      const lastUsed = this.cooldowns.get(cooldownKey) ?? 0;
      const elapsed = Date.now() - lastUsed;
      if (elapsed < tool.cooldownMs) {
        return {
          success: false,
          error: `Tool ${tool.name} is on cooldown (${Math.ceil((tool.cooldownMs - elapsed) / 1000)}s remaining)`,
        };
      }
      this.cooldowns.set(cooldownKey, Date.now());
    }

    const executor = this.executors.get(call.toolName);
    if (!executor) {
      throw new ToolError(`No executor registered for tool: ${call.toolName}`, call.toolName);
    }

    try {
      const result = await executor(call.arguments, context);
      this.log.debug({ tool: call.toolName, characterId, success: result.success }, 'Tool executed');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error({ tool: call.toolName, characterId, error: message }, 'Tool execution failed');
      return { success: false, error: message };
    }
  }

  /**
   * Clear cooldown entries for a specific character.
   * Called on character death to prevent memory leaks.
   */
  clearCharacterCooldowns(characterId: string): void {
    const suffix = `\0${characterId}`;
    for (const key of this.cooldowns.keys()) {
      if (key.endsWith(suffix)) {
        this.cooldowns.delete(key);
      }
    }
  }

  clear(): void {
    this.tools.clear();
    this.executors.clear();
    this.cooldowns.clear();
  }
}
