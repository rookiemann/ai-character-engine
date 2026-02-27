import type { EmotionType } from '../core/types';
import type { PerceptionManager } from './PerceptionManager';
import type { EmotionManager } from './EmotionManager';
import type { RelationshipManager } from './RelationshipManager';
import { getLogger } from '../core/logger';

/** How easily each emotion type spreads between characters. */
const CONTAGION_RATES: Record<EmotionType, number> = {
  fear: 0.6,
  anger: 0.4,
  joy: 0.5,
  sadness: 0.3,
  disgust: 0.3,
  surprise: 0.4,
  trust: 0.1,
  anticipation: 0.3,
};

/** Max intensity from contagion — shouldn't overwhelm direct emotions. */
const MAX_CONTAGION_INTENSITY = 0.3;

/** Only spread emotions above this threshold. */
const MIN_SOURCE_INTENSITY = 0.4;

/** Minimum applied intensity to bother with. */
const MIN_APPLIED = 0.05;

/**
 * Expansion 37: Mood Contagion
 *
 * Emotions spread between nearby characters. Panic is infectious,
 * celebrations lift everyone's spirits. No persistence — purely
 * ephemeral real-time processing on each slow tick.
 */
export class MoodContagionManager {
  private log = getLogger('mood-contagion');

  constructor(
    private perception: PerceptionManager,
    private emotions: EmotionManager,
    private relationships: RelationshipManager,
  ) {}

  /**
   * Process all locations for mood contagion. Called on tick:slow.
   */
  processContagion(): void {
    const locations = this.perception.getAllLocations();
    let totalApplied = 0;

    for (const [location, charIds] of locations) {
      if (charIds.length < 2) continue;

      // Collect strong emotions at this location
      const emotionSources = new Map<EmotionType, Array<{ charId: string; intensity: number }>>();

      for (const charId of charIds) {
        const charEmotions = this.emotions.getEmotions(charId);
        for (const emotion of charEmotions.active) {
          if (emotion.intensity < MIN_SOURCE_INTENSITY) continue;

          if (!emotionSources.has(emotion.type)) {
            emotionSources.set(emotion.type, []);
          }
          emotionSources.get(emotion.type)!.push({
            charId,
            intensity: emotion.intensity,
          });
        }
      }

      // Apply contagion for each aggregated emotion
      for (const [emotionType, sources] of emotionSources) {
        const sourceIds = new Set(sources.map(s => s.charId));
        const avgIntensity = sources.reduce((sum, s) => sum + s.intensity, 0) / sources.length;
        const contagionRate = CONTAGION_RATES[emotionType];
        const crowdFactor = this.getCrowdFactor(sources.length);

        // Apply to non-source characters at this location
        for (const targetId of charIds) {
          if (sourceIds.has(targetId)) continue;

          // Average relationship modifier with all sources
          let relModSum = 0;
          for (const source of sources) {
            relModSum += this.getRelationshipModifier(source.charId, targetId);
          }
          const relModifier = relModSum / sources.length;

          const applied = Math.min(
            MAX_CONTAGION_INTENSITY,
            avgIntensity * contagionRate * crowdFactor * relModifier,
          );

          if (applied < MIN_APPLIED) continue;

          this.emotions.applyEmotion(targetId, emotionType, applied, `contagion:${location}`);
          totalApplied++;
        }
      }
    }

    if (totalApplied > 0) {
      this.log.debug({ applied: totalApplied }, 'Mood contagion processed');
    }
  }

  /**
   * Relationship modifier: friends 1.5x, neutral 1.0x, enemies 0.3x.
   */
  private getRelationshipModifier(fromId: string, toId: string): number {
    const rels = this.relationships.getRelationships(fromId);
    const rel = rels.find(r =>
      (r.fromId === fromId && r.toId === toId) ||
      (r.fromId === toId && r.toId === fromId),
    );

    if (!rel) return 1.0; // neutral default

    switch (rel.type) {
      case 'friend':
      case 'ally':
      case 'family':
      case 'romantic':
        return 1.5;
      case 'mentor':
      case 'student':
        return 1.3;
      case 'enemy':
      case 'rival':
        return 0.3;
      default:
        return 1.0;
    }
  }

  /**
   * Crowd factor: more people expressing an emotion = stronger spread.
   * sqrt(count) / sqrt(10) — caps at 1.0 with 10 sources.
   */
  private getCrowdFactor(count: number): number {
    return Math.min(1.0, Math.sqrt(count) / Math.sqrt(10));
  }
}
