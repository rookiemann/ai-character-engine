import type { ProximityScore, ProximityConfig, ActivityTier, GameEvent } from '../core/types';
import { ProximityRepository } from '../db/repositories/ProximityRepository';
import { ProximityRules } from './ProximityRules';
import { TypedEventEmitter } from '../core/events';
import { getLogger } from '../core/logger';

/**
 * Manages the closeness scoring system and activity tier assignments.
 * Closeness 0-100 drives which tier a character belongs to.
 */
export class ProximityManager {
  private rules: ProximityRules;
  private log = getLogger('proximity');

  constructor(
    private repo: ProximityRepository,
    private emitter: TypedEventEmitter,
    config?: Partial<ProximityConfig>,
  ) {
    this.rules = new ProximityRules(config);
  }

  /**
   * Get proximity score for a character.
   */
  getScore(characterId: string, playerId: string): ProximityScore | null {
    return this.repo.get(characterId, playerId);
  }

  /**
   * Get all scores for a player.
   */
  getAllScores(playerId: string): ProximityScore[] {
    return this.repo.getAll(playerId);
  }

  /**
   * Get characters in a specific tier.
   */
  getByTier(tier: ActivityTier): ProximityScore[] {
    return this.repo.getByTier(tier);
  }

  /**
   * Boost closeness from a game interaction.
   */
  boostFromInteraction(characterId: string, playerId: string, eventType?: string): ProximityScore {
    const score = this.getOrCreate(characterId, playerId);
    const boost = this.rules.getInteractionBoost(eventType);
    return this.applyDelta(score, boost, 'interaction');
  }

  /**
   * Boost closeness from a chat message.
   */
  boostFromChat(characterId: string, playerId: string): ProximityScore {
    const score = this.getOrCreate(characterId, playerId);
    return this.applyDelta(score, this.rules.getChatBoost(), 'chat');
  }

  /**
   * Boost closeness from a game event (can be positive or negative).
   */
  boostFromEvent(characterId: string, playerId: string, delta: number): ProximityScore {
    const score = this.getOrCreate(characterId, playerId);
    return this.applyDelta(score, delta, 'event');
  }

  /**
   * Apply time-based decay to all characters. Called on slow tick.
   */
  applyDecay(playerId: string): void {
    const allScores = this.repo.getAll(playerId);

    for (const score of allScores) {
      if (score.closeness <= 0) continue;

      const decay = this.rules.calculateDecay(score);
      const newScore = this.rules.applyChange(score, -decay);
      const oldTier = score.activityTier;

      this.repo.upsert(newScore);

      if (newScore.activityTier !== oldTier) {
        this.emitter.emit('proximity:tierChanged', score.characterId, oldTier, newScore.activityTier);
        this.log.info({
          characterId: score.characterId,
          oldTier,
          newTier: newScore.activityTier,
          closeness: newScore.closeness,
        }, 'Tier changed from decay');
      }
    }
  }

  /**
   * Check if a character can chat.
   */
  canChat(characterId: string, playerId: string): boolean {
    const score = this.repo.get(characterId, playerId);
    return score ? this.rules.canChat(score.closeness) : false;
  }

  /**
   * Check if a character can be delegated to.
   */
  canDelegate(characterId: string, playerId: string): boolean {
    const score = this.repo.get(characterId, playerId);
    return score ? this.rules.canDelegate(score.closeness) : false;
  }

  /**
   * Update proximity configuration at runtime.
   */
  /**
   * Clear the proximity score for a character.
   */
  clearScore(characterId: string, playerId: string): void {
    this.repo.delete(characterId, playerId);
  }

  updateConfig(updates: Partial<ProximityConfig>): void {
    const current = this.rules.proximityConfig;
    (this.rules as any).config = { ...current, ...updates };
  }

  private getOrCreate(characterId: string, playerId: string): ProximityScore {
    const existing = this.repo.get(characterId, playerId);
    if (existing) return existing;

    const score: ProximityScore = {
      characterId,
      playerId,
      closeness: 0,
      highWaterMark: 0,
      activityTier: 'dormant',
      lastInteractionAt: Date.now(),
      totalInteractions: 0,
      updatedAt: Date.now(),
    };
    this.repo.upsert(score);
    return score;
  }

  private applyDelta(score: ProximityScore, delta: number, source: string): ProximityScore {
    const oldTier = score.activityTier;
    const updated = this.rules.applyChange(score, delta);
    updated.lastInteractionAt = Date.now();
    updated.totalInteractions = score.totalInteractions + 1;

    this.repo.upsert(updated);
    this.emitter.emit('proximity:changed', updated);

    if (updated.activityTier !== oldTier) {
      this.emitter.emit('proximity:tierChanged', score.characterId, oldTier, updated.activityTier);
      this.log.info({
        characterId: score.characterId,
        source,
        delta,
        oldTier,
        newTier: updated.activityTier,
        closeness: updated.closeness,
      }, 'Tier changed');
    }

    return updated;
  }
}
