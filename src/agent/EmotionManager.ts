import type { EmotionType, EmotionState, CharacterEmotions, GameEvent, Persistable } from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { getLogger } from '../core/logger';

const EMOTION_FLOORS: Record<string, number> = {
  anger: 0.15,    sadness: 0.12,    trust: 0.10,    fear: 0.08,
  disgust: 0.10,  anticipation: 0.05, joy: 0.05,    surprise: 0.03,
};

/**
 * Expansion 5: Emotion System
 *
 * Manages short-lived emotional states for characters.
 * Emotions decay over time and modify behavior through the prompt system.
 */
export class EmotionManager implements Persistable {
  private emotions = new Map<string, CharacterEmotions>();
  private log = getLogger('emotion-manager');

  // Default emotion responses to event types
  private static EVENT_EMOTIONS: Record<string, { type: EmotionType; intensity: number }[]> = {
    'combat': [{ type: 'fear', intensity: 0.6 }, { type: 'anger', intensity: 0.4 }],
    'death': [{ type: 'sadness', intensity: 0.9 }, { type: 'fear', intensity: 0.5 }],
    'gift': [{ type: 'joy', intensity: 0.7 }, { type: 'trust', intensity: 0.5 }],
    'insult': [{ type: 'anger', intensity: 0.7 }, { type: 'sadness', intensity: 0.3 }],
    'compliment': [{ type: 'joy', intensity: 0.6 }, { type: 'trust', intensity: 0.4 }],
    'betrayal': [{ type: 'anger', intensity: 0.8 }, { type: 'disgust', intensity: 0.6 }],
    'surprise_event': [{ type: 'surprise', intensity: 0.7 }],
    'threat': [{ type: 'fear', intensity: 0.7 }, { type: 'anticipation', intensity: 0.5 }],
    'success': [{ type: 'joy', intensity: 0.8 }, { type: 'anticipation', intensity: 0.3 }],
    'failure': [{ type: 'sadness', intensity: 0.5 }, { type: 'anger', intensity: 0.3 }],
    'dialogue': [{ type: 'trust', intensity: 0.2 }],
    'discovery': [{ type: 'surprise', intensity: 0.5 }, { type: 'anticipation', intensity: 0.6 }],
    'trade': [{ type: 'anticipation', intensity: 0.4 }, { type: 'trust', intensity: 0.3 }],
    'quest_start': [{ type: 'anticipation', intensity: 0.7 }, { type: 'joy', intensity: 0.3 }],
    'meeting': [{ type: 'trust', intensity: 0.4 }, { type: 'anticipation', intensity: 0.3 }],
    'conflict': [{ type: 'anger', intensity: 0.5 }, { type: 'fear', intensity: 0.3 }],
    'routine': [{ type: 'trust', intensity: 0.1 }],
    'alliance': [{ type: 'trust', intensity: 0.6 }, { type: 'joy', intensity: 0.4 }],
  };

  /**
   * Get the current emotional state for a character.
   */
  getEmotions(characterId: string): CharacterEmotions {
    if (!this.emotions.has(characterId)) {
      this.emotions.set(characterId, {
        characterId,
        active: [],
        mood: 'trust',
        moodIntensity: 0.1,
      });
    }
    return this.emotions.get(characterId)!;
  }

  /**
   * Apply an emotion to a character.
   */
  applyEmotion(
    characterId: string,
    type: EmotionType,
    intensity: number,
    source?: string,
  ): void {
    const state = this.getEmotions(characterId);
    const clamped = Math.max(0, Math.min(1, intensity));

    // Check if this emotion already exists - stack intensities
    const existing = state.active.find(e => e.type === type);
    if (existing) {
      existing.intensity = Math.min(1, existing.intensity + clamped * 0.5);
      existing.source = source;
      existing.createdAt = Date.now();
    } else {
      state.active.push({
        type,
        intensity: clamped,
        decayRate: 0.05,
        source,
        createdAt: Date.now(),
      });
    }

    this.recalculateMood(state);
    this.log.debug({ characterId, emotion: type, intensity: clamped }, 'Emotion applied');
  }

  /**
   * Process a game event and apply appropriate emotions.
   */
  processEvent(characterId: string, event: GameEvent): void {
    const emotionMap = EmotionManager.EVENT_EMOTIONS[event.type];
    if (!emotionMap) return;

    const importanceMultiplier = event.importance ? event.importance / 10 : 0.5;

    for (const { type, intensity } of emotionMap) {
      this.applyEmotion(
        characterId,
        type,
        intensity * importanceMultiplier,
        `${event.type}:${event.source ?? 'unknown'}`,
      );
    }
  }

  /**
   * Decay all emotions (called on each tick).
   */
  decayAll(): void {
    for (const [, state] of this.emotions) {
      state.active = state.active
        .map(e => {
          const floor = EMOTION_FLOORS[e.type] ?? 0.05;
          let intensity: number;
          if (e.intensity > floor) {
            intensity = e.intensity * (1 - e.decayRate);  // exponential
            if (intensity < floor) intensity = floor;      // clamp at floor
          } else {
            intensity = e.intensity - 0.001;               // slow sub-floor drain
          }
          return { ...e, intensity: Math.max(0, intensity) };
        })
        .filter(e => e.intensity > 0.02);

      this.recalculateMood(state);

      if (state.active.length === 0) {
        state.mood = 'trust';
        state.moodIntensity = 0.1;
      }
    }
  }

  /**
   * Get emotion description for prompt injection.
   */
  getEmotionPrompt(characterId: string): string | null {
    const state = this.getEmotions(characterId);
    if (state.active.length === 0) return null;

    const sorted = [...state.active].sort((a, b) => b.intensity - a.intensity);
    const descriptions = sorted.slice(0, 3).map(e => {
      const level = e.intensity > 0.7 ? 'strongly' : e.intensity > 0.4 ? 'moderately' : 'slightly';
      return `${level} feeling ${e.type}`;
    });

    return `Current emotions: ${descriptions.join(', ')}.`;
  }

  /**
   * Get dominant mood type and intensity.
   */
  getMood(characterId: string): { mood: EmotionType; intensity: number } {
    const state = this.getEmotions(characterId);
    return { mood: state.mood, intensity: state.moodIntensity };
  }

  /**
   * Clear all emotion data for a character.
   */
  clearCharacter(characterId: string): void {
    this.emotions.delete(characterId);
  }

  saveState(repo: StateRepository): void {
    const data: Array<{ characterId: string; activeEmotions: string; mood: string; moodIntensity: number }> = [];
    for (const [characterId, state] of this.emotions) {
      data.push({
        characterId,
        activeEmotions: JSON.stringify(state.active),
        mood: state.mood,
        moodIntensity: state.moodIntensity,
      });
    }
    repo.clearEmotions();
    if (data.length > 0) repo.saveEmotions(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllEmotions();
    this.emotions.clear();
    for (const row of rows) {
      this.emotions.set(row.characterId, {
        characterId: row.characterId,
        active: JSON.parse(row.activeEmotions),
        mood: row.mood as EmotionType,
        moodIntensity: row.moodIntensity,
      });
    }
    this.log.debug({ count: rows.length }, 'Emotions loaded from DB');
  }

  private recalculateMood(state: CharacterEmotions): void {
    if (state.active.length === 0) return;
    const dominant = state.active.reduce((max, e) =>
      e.intensity > max.intensity ? e : max,
    );
    state.mood = dominant.type;
    state.moodIntensity = dominant.intensity;
  }
}
