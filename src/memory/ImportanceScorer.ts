import type { GameEvent } from '../core/types';

/**
 * Pluggable importance scoring for memory events.
 * Pure code scoring - no LLM calls. Games can override via plugin.
 */
export type ImportanceScorerFn = (event: GameEvent, characterId: string) => number;

/**
 * Default importance scoring based on event type and data.
 * Returns 1-10 score.
 */
export const defaultImportanceScorer: ImportanceScorerFn = (event, characterId) => {
  let score = 3; // Baseline

  // Events targeting this character are more important
  if (event.target === characterId) score += 2;
  if (event.source === characterId) score += 1;

  // Use event-provided importance if available
  if (event.importance !== undefined) {
    return Math.max(1, Math.min(10, event.importance));
  }

  // Type-based scoring
  const typeScores: Record<string, number> = {
    'combat': 7,
    'death': 10,
    'trade': 4,
    'dialogue': 5,
    'quest_start': 6,
    'quest_complete': 8,
    'betrayal': 9,
    'gift': 6,
    'insult': 5,
    'discovery': 7,
    'injury': 7,
    'alliance': 8,
    'meeting': 4,
    'farewell': 5,
    'conflict': 6,
    'rescue': 9,
    'loss': 8,
    'achievement': 7,
    'routine': 2,
    'ambient': 1,
  };

  if (event.type in typeScores) {
    score = typeScores[event.type];
  }

  return Math.max(1, Math.min(10, score));
};

/**
 * Creates a composite scorer that tries game-specific scoring first,
 * falling back to the default scorer.
 */
export function createCompositeScorer(
  gameScorer?: (characterId: string, event: GameEvent) => number | undefined,
): ImportanceScorerFn {
  return (event, characterId) => {
    if (gameScorer) {
      const gameScore = gameScorer(characterId, event);
      if (gameScore !== undefined) {
        return Math.max(1, Math.min(10, gameScore));
      }
    }
    return defaultImportanceScorer(event, characterId);
  };
}
