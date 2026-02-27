import type { ProximityConfig, ActivityTier, ProximityScore } from '../core/types';
import { DEFAULT_PROXIMITY } from '../core/config';

/**
 * Default proximity rules for decay, promotion, and tier assignment.
 */
export class ProximityRules {
  private config: ProximityConfig;

  constructor(config?: Partial<ProximityConfig>) {
    this.config = { ...DEFAULT_PROXIMITY, ...config };
  }

  /**
   * Calculate decay amount based on current closeness and history.
   */
  calculateDecay(score: ProximityScore): number {
    let decay = this.config.decayRatePerTick;

    // Established relationships (high water mark) fade slower
    if (score.highWaterMark > this.config.promotionThreshold) {
      decay *= this.config.highWaterDecayMultiplier;
    }

    // Very close characters decay even slower
    if (score.closeness > 80) {
      decay *= 0.5;
    }

    return decay;
  }

  /**
   * Calculate boost from an interaction.
   */
  getInteractionBoost(eventType?: string): number {
    const boosts: Record<string, number> = {
      'combat': 5,
      'quest_complete': 5,
      'rescue': 8,
      'betrayal': -10,
      'gift': 4,
      'trade': 3,
      'dialogue': 2,
      'alliance': 6,
      'conflict': -3,
      'meeting': 2,
    };

    if (eventType && eventType in boosts) {
      return boosts[eventType];
    }

    return this.config.interactionBoost;
  }

  /**
   * Get the chat boost amount.
   */
  getChatBoost(): number {
    return this.config.chatBoost;
  }

  /**
   * Determine the activity tier for a given closeness value.
   */
  getTier(closeness: number): ActivityTier {
    if (closeness >= this.config.promotionThreshold) return 'active';
    if (closeness >= this.config.backgroundThreshold) return 'background';
    return 'dormant';
  }

  /**
   * Check if a character can receive chat messages.
   */
  canChat(closeness: number): boolean {
    return closeness >= this.config.chatMinCloseness;
  }

  /**
   * Check if a character can receive delegations.
   */
  canDelegate(closeness: number): boolean {
    return closeness >= this.config.delegateMinCloseness;
  }

  /**
   * Apply closeness change and return the new score.
   */
  applyChange(score: ProximityScore, delta: number): ProximityScore {
    const newCloseness = Math.max(0, Math.min(100, score.closeness + delta));
    const newHighWater = Math.max(score.highWaterMark, newCloseness);
    const newTier = this.getTier(newCloseness);

    return {
      ...score,
      closeness: newCloseness,
      highWaterMark: newHighWater,
      activityTier: newTier,
      updatedAt: Date.now(),
    };
  }

  get proximityConfig(): ProximityConfig {
    return this.config;
  }
}
