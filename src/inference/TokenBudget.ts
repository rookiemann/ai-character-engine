import type { ActivityTier, InferenceTier } from '../core/types';

/**
 * Token budget per activity tier. Controls how much context
 * each character gets based on their proximity tier.
 */
export interface TokenBudgetConfig {
  active: { context: number; response: number };
  background: { context: number; response: number };
  dormant: { context: number; response: number };
}

const DEFAULT_BUDGETS: TokenBudgetConfig = {
  active: { context: 800, response: 150 },
  background: { context: 400, response: 100 },
  dormant: { context: 250, response: 80 },
};

/**
 * Importance thresholds for adaptive budget boosts.
 * When an event's importance exceeds the threshold for a tier,
 * the character temporarily gets the next tier's budget.
 */
const BOOST_THRESHOLDS: Record<ActivityTier, number> = {
  active: 999,    // Active already has max budget, no boost
  background: 6,  // Background chars with importance >= 6 get active budget
  dormant: 5,     // Dormant chars with importance >= 5 get background budget
};

export class TokenBudget {
  private budgets: TokenBudgetConfig;

  constructor(overrides?: Partial<TokenBudgetConfig>) {
    this.budgets = { ...DEFAULT_BUDGETS, ...overrides };
  }

  /**
   * Get context budget for a tier.
   * Optionally boost based on event importance — a dormant character
   * reacting to an important event temporarily gets a higher budget.
   */
  getContextBudget(tier: ActivityTier, importance?: number): number {
    const effectiveTier = this.getEffectiveTier(tier, importance);
    return this.budgets[effectiveTier].context;
  }

  /**
   * Get response budget for a tier, with optional importance boost.
   */
  getResponseBudget(tier: ActivityTier, importance?: number): number {
    const effectiveTier = this.getEffectiveTier(tier, importance);
    return this.budgets[effectiveTier].response;
  }

  /**
   * Get the effective tier after importance-based boosting.
   * dormant + high importance → background
   * background + high importance → active
   * active stays active
   */
  getEffectiveTier(tier: ActivityTier, importance?: number): ActivityTier {
    if (importance === undefined) return tier;
    if (importance < BOOST_THRESHOLDS[tier]) return tier;

    // Boost up one tier
    if (tier === 'dormant') return 'background';
    if (tier === 'background') return 'active';
    return 'active';
  }

  /**
   * Select inference tier based on activity tier and event importance.
   * Active characters use heavy more aggressively when a heavy model is available.
   */
  selectInferenceTier(activityTier: ActivityTier, importance?: number): InferenceTier {
    const effectiveTier = this.getEffectiveTier(activityTier, importance);

    if (effectiveTier === 'active') {
      if (importance !== undefined && importance >= 5) return 'heavy';
      return 'mid';
    }

    if (effectiveTier === 'background') {
      if (importance !== undefined && importance >= 8) return 'heavy';
      return 'mid';
    }

    // Dormant always uses light
    return 'light';
  }

  /**
   * Rough token estimation for a string (4 chars ≈ 1 token).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Trim text to fit within a token budget.
   * Trims from the beginning (oldest content) to preserve recent context.
   */
  trimToFit(text: string, maxTokens: number): string {
    const estimated = this.estimateTokens(text);
    if (estimated <= maxTokens) return text;

    const maxChars = maxTokens * 4;
    return '...' + text.slice(text.length - maxChars + 3);
  }

  /**
   * Trim an array of text items to fit within budget.
   * Removes from the front (oldest) first.
   */
  trimArrayToFit(items: string[], maxTokens: number): string[] {
    let totalTokens = items.reduce((sum, item) => sum + this.estimateTokens(item), 0);

    const result = [...items];
    while (totalTokens > maxTokens && result.length > 1) {
      const removed = result.shift()!;
      totalTokens -= this.estimateTokens(removed);
    }

    return result;
  }
}
