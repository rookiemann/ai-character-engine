import type {
  InferenceMessage,
  CharacterState,
  GameState,
  CharacterProprioception,
  MemoryRecord,
  WorkingMemoryEntry,
  CharacterSummaryRecord,
  GameEvent,
  DelegationOrder,
  ActivityTier,
  ToolDefinition,
} from '../core/types';
import { PromptBuilder, type PromptExtensions } from './PromptBuilder';
import { TokenBudget } from '../inference/TokenBudget';

/**
 * Assembles the full LLM context for an agent decision call.
 * Combines: system prompt + episodic memories + working memory + situation.
 * Enforces token budget based on activity tier.
 *
 * Uses structured XML-style blocks so the LLM can clearly distinguish
 * identity, memories, situation, and instructions.
 */
export class ContextAssembler {
  private promptBuilder = new PromptBuilder();
  private tokenBudget: TokenBudget;

  constructor(tokenBudget?: TokenBudget) {
    this.tokenBudget = tokenBudget ?? new TokenBudget();
  }

  /**
   * Assemble the full message array for an agent decision.
   */
  assemble(params: {
    character: CharacterState;
    gameState: GameState;
    proprioception: CharacterProprioception;
    episodicMemories: MemoryRecord[];
    workingMemory: WorkingMemoryEntry[];
    characterSummary: CharacterSummaryRecord | null;
    triggerEvent?: GameEvent;
    worldRules?: string;
    delegations?: DelegationOrder[];
    recentActions?: string[];
    extensions?: PromptExtensions;
    availableTools?: ToolDefinition[];
  }): InferenceMessage[] {
    const {
      character,
      gameState,
      proprioception,
      episodicMemories,
      workingMemory,
      characterSummary,
      triggerEvent,
      worldRules,
      delegations,
      recentActions,
      extensions,
      availableTools,
    } = params;

    const tier = character.activityTier;
    const importance = triggerEvent?.importance;
    const budget = this.tokenBudget.getContextBudget(tier, importance);
    const messages: InferenceMessage[] = [];
    let tokensUsed = 0;

    // 1. System prompt — build without extensions first to check budget
    //    Pass the full budget so PromptBuilder can do incremental hint fitting
    const basePrompt = this.promptBuilder.buildSystemPrompt(
      character, worldRules, characterSummary, delegations, undefined, availableTools,
    );
    const baseTokens = this.tokenBudget.estimateTokens(basePrompt);

    let systemPrompt: string;
    if (extensions && baseTokens < budget * 0.45) {
      // Pass token budget so hint fitting knows how much space is available
      systemPrompt = this.promptBuilder.buildSystemPrompt(
        character, worldRules, characterSummary, delegations, extensions, availableTools, budget,
      );
      // Verify extensions didn't blow the budget
      if (this.tokenBudget.estimateTokens(systemPrompt) > budget * 0.65) {
        systemPrompt = basePrompt;
      }
    } else {
      systemPrompt = basePrompt;
    }
    messages.push({ role: 'system', content: systemPrompt });
    tokensUsed += this.tokenBudget.estimateTokens(systemPrompt);

    // 2. Episodic memories — sorted by importance, not just index order
    if (episodicMemories.length > 0) {
      const memoryBlock = this.formatMemories(episodicMemories, tier);
      const memTokens = this.tokenBudget.estimateTokens(memoryBlock);

      if (tokensUsed + memTokens < budget * 0.75) {
        messages.push({ role: 'user', content: memoryBlock });
        tokensUsed += memTokens;
      }
    }

    // 3. Working memory (recent conversation turns)
    if (workingMemory.length > 0) {
      const workingTokenBudget = Math.floor((budget - tokensUsed) * 0.5);
      const workingItems = workingMemory.map(w => `- (${w.role}) ${w.content}`);
      const trimmed = this.tokenBudget.trimArrayToFit(workingItems, workingTokenBudget);

      if (trimmed.length > 0) {
        const workingBlock = 'Recent exchanges:\n' + trimmed.join('\n');
        messages.push({ role: 'user', content: workingBlock });
        tokensUsed += this.tokenBudget.estimateTokens(workingBlock);
      }
    }

    // 4. Current situation (game state + proprioception + trigger)
    let situationBlock = this.formatSituation(gameState, proprioception, triggerEvent);

    // 5. Variety enforcement — warn about repetition AND suggest underused tools
    if (recentActions && recentActions.length >= 2) {
      const total = recentActions.length;
      const counts = new Map<string, number>();
      for (const a of recentActions) {
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }

      // Find dominant action (>40% of recent actions)
      const dominant = [...counts.entries()].filter(([, c]) => c / total > 0.4);
      if (dominant.length > 0) {
        const dominantNames = dominant.map(([name, c]) => `${name} (x${c})`).join(', ');
        situationBlock += `\n\nYou have been doing ${dominantNames} repeatedly. Choose a DIFFERENT action this time.`;
      }

      // Suggest underused tools if available
      if (availableTools && availableTools.length > 0) {
        const usedTools = new Set(
          recentActions.filter(a => a.startsWith('tool:')).map(a => a.slice(5)),
        );
        const unused = availableTools
          .map(t => t.name)
          .filter(name => !usedTools.has(name));
        if (unused.length > 0) {
          situationBlock += `\nYou haven't tried: ${unused.join(', ')}.`;
        }
      }
    }

    const sitTokens = this.tokenBudget.estimateTokens(situationBlock);

    if (tokensUsed + sitTokens <= budget) {
      messages.push({ role: 'user', content: situationBlock });
    } else {
      const trimmed = this.tokenBudget.trimToFit(situationBlock, budget - tokensUsed);
      messages.push({ role: 'user', content: trimmed });
    }

    return messages;
  }

  /**
   * Assemble context for a chat response.
   */
  assembleChat(params: {
    character: CharacterState;
    chatHistory: Array<{ role: string; content: string }>;
    episodicMemories: MemoryRecord[];
    characterSummary: CharacterSummaryRecord | null;
    playerMessage: string;
  }): InferenceMessage[] {
    const { character, chatHistory, episodicMemories, characterSummary, playerMessage } = params;
    const messages: InferenceMessage[] = [];

    // System prompt
    const systemPrompt = this.promptBuilder.buildChatPrompt(character, characterSummary);
    messages.push({ role: 'system', content: systemPrompt });

    // Key memories
    if (episodicMemories.length > 0) {
      const memBlock = episodicMemories
        .slice(0, 3)
        .map(m => `- ${m.summary}`)
        .join('\n');
      messages.push({ role: 'user', content: `Key memories:\n${memBlock}` });
      messages.push({ role: 'assistant', content: 'I remember these things.' });
    }

    // Chat history
    for (const msg of chatHistory.slice(-6)) {
      messages.push({
        role: msg.role === 'player' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // Current player message
    messages.push({ role: 'user', content: playerMessage });

    return messages;
  }

  private formatMemories(memories: MemoryRecord[], tier: ActivityTier): string {
    const count = tier === 'active' ? 5 : tier === 'background' ? 3 : 1;

    // Permanent (trauma) memories always included first, don't count toward tier limit
    const permanent = memories.filter(m => m.isPermanent);
    const regular = memories.filter(m => !m.isPermanent);

    // Sort regular by importance (descending), take up to tier limit
    const sorted = [...regular].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    const selected = sorted.slice(0, count);

    // Combine: regular first, trauma lingering at the back
    const all = [...selected, ...permanent];

    const lines = all.map(m => {
      const marker = m.isPermanent ? ' [trauma]' : m.isDeep ? ' [deep memory]' : '';
      return `- ${m.summary}${marker}`;
    });

    return 'Significant memories:\n' + lines.join('\n');
  }

  private formatSituation(
    gameState: GameState,
    proprioception: CharacterProprioception,
    triggerEvent?: GameEvent,
  ): string {
    const parts: string[] = ['Current situation:'];

    if (proprioception.location) {
      parts.push(`Location: ${proprioception.location}`);
    }

    if (proprioception.currentAction) {
      parts.push(`Currently: ${proprioception.currentAction}`);
    }

    if (proprioception.status && proprioception.status.length > 0) {
      parts.push(`Status: ${proprioception.status.join(', ')}`);
    }

    if (proprioception.inventory && proprioception.inventory.length > 0) {
      parts.push(`Inventory: ${proprioception.inventory.join(', ')}`);
    }

    if (proprioception.energy !== undefined) {
      const level = proprioception.energy > 0.7 ? 'high'
        : proprioception.energy > 0.4 ? 'moderate' : 'low';
      parts.push(`Energy: ${level}`);
    }

    if (proprioception.custom) {
      const entries = Object.entries(proprioception.custom);
      if (entries.length > 0 && entries.length <= 5) {
        const customStr = entries.map(([k, v]) => `${k}: ${v}`).join(', ');
        if (customStr.length < 150) {
          parts.push(`Self: ${customStr}`);
        }
      }
    }

    if (gameState.nearbyEntities && gameState.nearbyEntities.length > 0) {
      parts.push(`Nearby: ${gameState.nearbyEntities.join(', ')}`);
    }

    if (gameState.recentEvents && gameState.recentEvents.length > 0) {
      parts.push(`Recent events: ${gameState.recentEvents.slice(-3).join('; ')}`);
    }

    if (triggerEvent) {
      parts.push(`\nTriggering event: ${triggerEvent.type}${triggerEvent.source ? ` from ${triggerEvent.source}` : ''}`);
      if (triggerEvent.data) {
        const dataStr = JSON.stringify(triggerEvent.data);
        if (dataStr.length < 200) {
          parts.push(`Event data: ${dataStr}`);
        }
      }
    }

    if (gameState.custom) {
      const customStr = Object.entries(gameState.custom)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      if (customStr.length < 200) {
        parts.push(`World: ${customStr}`);
      }
    }

    return parts.join('\n');
  }
}
