import type {
  CharacterState,
  CharacterSummaryRecord,
  DelegationOrder,
  ToolDefinition,
  ActivityTier,
} from '../core/types';

/**
 * Extended context hints that expansion systems inject into prompts.
 * Each hint is a short natural-language sentence from a subsystem.
 */
export interface PromptExtensions {
  emotionHint?: string | null;
  relationshipHint?: string | null;
  goalHint?: string | null;
  worldStateHint?: string | null;
  groupHint?: string | null;
  playerHint?: string | null;
  initiativeHint?: string | null;
  routineHint?: string | null;
  needsHint?: string | null;
  perceptionHint?: string | null;
  gossipHint?: string | null;
  reputationHint?: string | null;
  hierarchyHint?: string | null;
}

/**
 * Priority tiers for hints. High-priority hints are always included first.
 * Low-priority hints fill remaining budget space.
 */
const HINT_PRIORITY: Array<{ key: keyof PromptExtensions; tier: 'high' | 'low' }> = [
  { key: 'initiativeHint', tier: 'high' },
  { key: 'hierarchyHint',  tier: 'high' },
  { key: 'needsHint',      tier: 'high' },
  { key: 'emotionHint',    tier: 'high' },
  { key: 'goalHint',       tier: 'high' },
  { key: 'relationshipHint', tier: 'high' },
  { key: 'perceptionHint', tier: 'low' },
  { key: 'routineHint',    tier: 'low' },
  { key: 'worldStateHint', tier: 'low' },
  { key: 'groupHint',      tier: 'low' },
  { key: 'playerHint',     tier: 'low' },
  { key: 'gossipHint',     tier: 'low' },
  { key: 'reputationHint', tier: 'low' },
];

/** Max hints per activity tier. Active characters get more context. */
const MAX_HINTS: Record<ActivityTier, number> = {
  active: 6,
  background: 4,
  dormant: 2,
};

/** Rough token estimation: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Builds structured prompts for agent decision calls.
 *
 * Uses XML-style sections so the LLM can parse distinct context blocks.
 * Implements incremental hint fitting — adds hints one-by-one within
 * the token budget instead of all-or-nothing inclusion.
 * Caches prompts by input hash — identity/summary changes rarely, so
 * most decisions reuse the cached prompt.
 */
export class PromptBuilder {
  private cache = new Map<string, string>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private static MAX_CACHE_SIZE = 128;

  /**
   * Build the system prompt for an agent decision.
   * Uses structured sections with XML tags for clarity.
   * Results are cached by a hash of all inputs.
   */
  buildSystemPrompt(
    character: CharacterState,
    worldRules?: string,
    summary?: CharacterSummaryRecord | null,
    delegations?: DelegationOrder[],
    extensions?: PromptExtensions,
    availableTools?: ToolDefinition[],
    tokenBudget?: number,
  ): string {
    // --- Cache lookup ---
    const cacheKey = this.computeCacheKey(character, worldRules, summary, delegations, extensions, availableTools, tokenBudget);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cacheHits++;
      return cached;
    }
    this.cacheMisses++;

    const sections: string[] = [];

    // --- Identity ---
    const identityLines = [
      `You are ${character.name}, a ${character.archetype}.`,
      `Personality: ${character.identity.personality}`,
    ];
    if (character.identity.traits.length > 0) {
      identityLines.push(`Traits: ${character.identity.traits.join(', ')}`);
    }
    if (character.identity.speechStyle) {
      identityLines.push(`Speech: ${character.identity.speechStyle}`);
    }
    if (character.identity.goals.length > 0) {
      identityLines.push(`Goals: ${character.identity.goals.join('; ')}`);
    }
    sections.push(`<identity>\n${identityLines.join('\n')}\n</identity>`);

    // --- World rules ---
    if (worldRules) {
      sections.push(`<world>\n${worldRules}\n</world>`);
    }

    // --- Memory/story ---
    if (summary) {
      let memText = summary.summary;
      if (summary.relationshipNotes) {
        memText += `\nRelationship with player: ${summary.relationshipNotes}`;
      }
      sections.push(`<backstory>\n${memText}\n</backstory>`);
    }

    // --- Delegations ---
    if (delegations && delegations.length > 0) {
      const lines = delegations.map(d => `- ${d.instruction} (scope: ${d.scope})`);
      sections.push(`<delegations>\n${lines.join('\n')}\n</delegations>`);
    }

    // --- Expansion hints (incremental fitting) ---
    const hintSection = this.buildHintSection(
      extensions,
      character.activityTier,
      tokenBudget,
      sections,
    );
    if (hintSection) {
      sections.push(hintSection);
    }

    // --- Tools ---
    if (availableTools && availableTools.length > 0) {
      sections.push(this.buildToolSection(availableTools));
    }

    // --- Instructions ---
    if (availableTools && availableTools.length > 0) {
      sections.push(
        '<instructions>\n'
        + 'You are a CHARACTER in this world making decisions. You are NOT a narrator, game master, or assistant.\n'
        + 'You MUST pick a tool and act. Respond with ONLY valid JSON:\n'
        + '{"tool": "<tool_name>", "arguments": {<required_args>}}\n'
        + 'Do NOT ask questions, narrate scenes, or describe what others do. Just pick a tool.\n'
        + 'Consider ALL available tools. Vary your actions — do not repeat the same tool.\n'
        + '</instructions>',
      );
    } else {
      sections.push(
        '<instructions>\n'
        + 'Respond with dialogue or describe what you do. Stay in character. Be concise.\n'
        + 'You are a CHARACTER — do not narrate, ask meta-questions, or act as a game master.\n'
        + '</instructions>',
      );
    }

    const result = sections.join('\n\n');

    // Store in cache (evict oldest if at capacity)
    if (this.cache.size >= PromptBuilder.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, result);

    return result;
  }

  /**
   * Compute a fast cache key from all prompt inputs.
   * Uses a simple FNV-like hash of stringified inputs.
   */
  private computeCacheKey(
    character: CharacterState,
    worldRules?: string,
    summary?: CharacterSummaryRecord | null,
    delegations?: DelegationOrder[],
    extensions?: PromptExtensions,
    availableTools?: ToolDefinition[],
    tokenBudget?: number,
  ): string {
    // Only hash fields that actually affect the prompt output
    const parts = [
      character.id,
      character.name,
      character.archetype,
      character.identity.personality,
      character.identity.traits.join(','),
      character.identity.speechStyle ?? '',
      character.identity.goals.join(','),
      character.activityTier,
      worldRules ?? '',
      summary?.summary ?? '',
      summary?.relationshipNotes ?? '',
      delegations?.map(d => `${d.instruction}:${d.scope}`).join(';') ?? '',
      availableTools?.map(t => t.name).join(',') ?? '',
      String(tokenBudget ?? 0),
    ];

    // Hash extension hints (only non-null values matter)
    if (extensions) {
      for (const { key } of HINT_PRIORITY) {
        parts.push(extensions[key] ?? '');
      }
    }

    // Simple string hash (fast, not cryptographic)
    let hash = 2166136261;
    const str = parts.join('|');
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(36);
  }

  /** Cache statistics for monitoring. */
  getCacheStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.cache.size,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    };
  }

  /** Clear the prompt cache. */
  clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Build hint section with incremental fitting.
   * Adds hints one-by-one, stopping when budget is exhausted.
   */
  private buildHintSection(
    extensions: PromptExtensions | undefined,
    tier: ActivityTier,
    tokenBudget: number | undefined,
    existingSections: string[],
  ): string | null {
    if (!extensions) return null;

    const maxHints = MAX_HINTS[tier];
    const hints: string[] = [];

    // Calculate remaining token budget for hints
    const existingTokens = estimateTokens(existingSections.join('\n\n'));
    // Reserve ~40% of budget for hints if budget provided, else allow generous amount
    const hintBudget = tokenBudget
      ? Math.floor(tokenBudget * 0.25)
      : 200; // ~800 chars
    let hintTokens = 0;

    // Add hints in priority order, checking budget for each
    for (const { key } of HINT_PRIORITY) {
      if (hints.length >= maxHints) break;

      const hint = extensions[key];
      if (!hint) continue;

      const cost = estimateTokens(hint);
      if (hintTokens + cost > hintBudget) continue; // Skip this hint, try next (smaller ones may fit)

      hints.push(hint);
      hintTokens += cost;
    }

    if (hints.length === 0) return null;
    return `<context>\n${hints.join('\n')}\n</context>`;
  }

  /**
   * Build tool section with structured format.
   * Includes parameter descriptions and enums for better LLM understanding.
   */
  private buildToolSection(tools: ToolDefinition[]): string {
    const lines: string[] = [];
    for (const tool of tools) {
      const params = tool.parameters
        .map(p => {
          let desc = `${p.name}: ${p.type}`;
          if (p.required === false) desc += '?';
          if (p.enum) desc += ` [${p.enum.join('|')}]`;
          return desc;
        })
        .join(', ');
      lines.push(`- ${tool.name}(${params}) — ${tool.description}`);
    }
    return `<tools>\n${lines.join('\n')}\n</tools>`;
  }

  /**
   * Build a chat-specific system prompt (for direct player conversations).
   */
  buildChatPrompt(
    character: CharacterState,
    summary?: CharacterSummaryRecord | null,
  ): string {
    const sections: string[] = [];

    const identityLines = [
      `You are ${character.name}, a ${character.archetype}.`,
      `Personality: ${character.identity.personality}`,
    ];
    if (character.identity.traits.length > 0) {
      identityLines.push(`Traits: ${character.identity.traits.join(', ')}`);
    }
    if (character.identity.speechStyle) {
      identityLines.push(`Speech: ${character.identity.speechStyle}`);
    }
    sections.push(`<identity>\n${identityLines.join('\n')}\n</identity>`);

    if (summary) {
      let memText = summary.summary;
      if (summary.relationshipNotes) {
        memText += `\nRelationship with player: ${summary.relationshipNotes}`;
      }
      sections.push(`<backstory>\n${memText}\n</backstory>`);
    }

    sections.push(
      '<instructions>\nYou\'re having a conversation with the player. Stay in character. Be natural and concise.\n</instructions>',
    );

    return sections.join('\n\n');
  }
}
