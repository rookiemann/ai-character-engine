import type { ActivityTier, CharacterState } from '../core/types';
import { AgentRegistry } from '../agent/AgentRegistry';
import { ProximityManager } from '../proximity/ProximityManager';
import { getLogger } from '../core/logger';

/**
 * Manages activity tier assignments based on proximity scores.
 * Tiers determine tick rate, token budget, and capabilities.
 *
 * Active (>= 60):     Fast tick, full context, all features
 * Background (20-59): Slow tick, reduced context, limited chat
 * Dormant (< 20):     Slow tick sparse, minimal context, no features
 */
export class ActivityTierManager {
  private log = getLogger('activity-tier');

  constructor(
    private registry: AgentRegistry,
    private proximity: ProximityManager,
  ) {}

  /**
   * Refresh tier assignments for all characters based on current proximity.
   */
  refreshTiers(playerId: string): Map<string, ActivityTier> {
    const scores = this.proximity.getAllScores(playerId);
    const tierMap = new Map<string, ActivityTier>();

    for (const score of scores) {
      const character = this.registry.get(score.characterId);
      if (!character) continue;

      const newTier = score.activityTier;
      if (character.activityTier !== newTier) {
        this.registry.update(character.id, { activityTier: newTier });
        this.log.debug({ characterId: character.id, oldTier: character.activityTier, newTier }, 'Tier updated');
      }
      tierMap.set(character.id, newTier);
    }

    return tierMap;
  }

  /**
   * Get all characters in the active tier.
   */
  getActiveCharacters(): CharacterState[] {
    return this.registry.getByTier('active');
  }

  /**
   * Get all characters in the background tier.
   */
  getBackgroundCharacters(): CharacterState[] {
    return this.registry.getByTier('background');
  }

  /**
   * Get all characters in the dormant tier.
   */
  getDormantCharacters(): CharacterState[] {
    return this.registry.getByTier('dormant');
  }

  /**
   * Get a tier breakdown count.
   */
  getTierCounts(): Record<ActivityTier, number> {
    return {
      active: this.registry.getByTier('active').length,
      background: this.registry.getByTier('background').length,
      dormant: this.registry.getByTier('dormant').length,
    };
  }
}
