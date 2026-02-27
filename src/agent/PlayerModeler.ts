import type { PlayerProfile, InteractionPattern, GameEvent, Persistable } from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { getLogger } from '../core/logger';

/**
 * Expansion 9: Player Modeling
 *
 * Tracks player behavior patterns so characters can adapt.
 * Characters can reference player preferences in their decision context.
 */
export class PlayerModeler implements Persistable {
  private profiles = new Map<string, PlayerProfile>();
  private log = getLogger('player-modeler');

  /**
   * Get or create a player profile.
   */
  getProfile(playerId: string): PlayerProfile {
    if (!this.profiles.has(playerId)) {
      this.profiles.set(playerId, {
        playerId,
        preferences: {},
        interactionPatterns: [],
        totalInteractions: 0,
        averageSessionLength: 0,
        lastSeenAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return this.profiles.get(playerId)!;
  }

  /**
   * Record a player interaction.
   */
  recordInteraction(playerId: string, type: string): void {
    const profile = this.getProfile(playerId);
    profile.totalInteractions++;
    profile.lastSeenAt = Date.now();
    profile.updatedAt = Date.now();

    // Update interaction pattern
    const existing = profile.interactionPatterns.find(p => p.type === type);
    if (existing) {
      existing.count++;
      existing.lastAt = Date.now();
    } else {
      profile.interactionPatterns.push({
        type,
        count: 1,
        lastAt: Date.now(),
      });
    }

    // Update preference score (normalized count)
    const totalPatterns = profile.interactionPatterns.reduce((sum, p) => sum + p.count, 0);
    for (const pattern of profile.interactionPatterns) {
      profile.preferences[pattern.type] = pattern.count / totalPatterns;
    }

    this.log.debug({ playerId, type, total: profile.totalInteractions }, 'Interaction recorded');
  }

  /**
   * Record a game event for player modeling.
   */
  recordEvent(playerId: string, event: GameEvent): void {
    this.recordInteraction(playerId, event.type);

    // Also track source-specific patterns
    if (event.source) {
      this.recordInteraction(playerId, `source:${event.source}`);
    }
  }

  /**
   * Get the player's top preferences.
   */
  getTopPreferences(playerId: string, limit: number = 5): Array<{ type: string; score: number }> {
    const profile = this.getProfile(playerId);
    return Object.entries(profile.preferences)
      .filter(([type]) => !type.startsWith('source:'))
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([type, score]) => ({ type, score }));
  }

  /**
   * Get player preference prompt text for context injection.
   */
  getPlayerPrompt(playerId: string): string | null {
    const profile = this.getProfile(playerId);
    if (profile.totalInteractions < 5) return null; // Need minimum data

    const topPrefs = this.getTopPreferences(playerId, 3);
    if (topPrefs.length === 0) return null;

    const prefLines = topPrefs.map(p =>
      `${p.type} (${Math.round(p.score * 100)}%)`,
    );

    return `Player tends to prefer: ${prefLines.join(', ')}.`;
  }

  /**
   * Check if a player prefers a certain interaction type.
   */
  prefersType(playerId: string, type: string, threshold: number = 0.3): boolean {
    const profile = this.getProfile(playerId);
    return (profile.preferences[type] ?? 0) >= threshold;
  }

  saveState(repo: StateRepository): void {
    const data: Array<{
      playerId: string; preferences: string; interactionPatterns: string;
      totalInteractions: number; averageSessionLength: number;
      lastSeenAt: number; updatedAt: number;
    }> = [];
    for (const profile of this.profiles.values()) {
      data.push({
        playerId: profile.playerId,
        preferences: JSON.stringify(profile.preferences),
        interactionPatterns: JSON.stringify(profile.interactionPatterns),
        totalInteractions: profile.totalInteractions,
        averageSessionLength: profile.averageSessionLength,
        lastSeenAt: profile.lastSeenAt,
        updatedAt: profile.updatedAt,
      });
    }
    repo.clearPlayerProfiles();
    if (data.length > 0) repo.savePlayerProfiles(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllPlayerProfiles();
    this.profiles.clear();
    for (const r of rows) {
      this.profiles.set(r.playerId, {
        playerId: r.playerId,
        preferences: JSON.parse(r.preferences),
        interactionPatterns: JSON.parse(r.interactionPatterns),
        totalInteractions: r.totalInteractions,
        averageSessionLength: r.averageSessionLength,
        lastSeenAt: r.lastSeenAt,
        updatedAt: r.updatedAt,
      });
    }
    this.log.debug({ count: rows.length }, 'Player profiles loaded from DB');
  }

  /**
   * Update session length tracking.
   */
  recordSessionEnd(playerId: string, durationMs: number): void {
    const profile = this.getProfile(playerId);
    const sessions = profile.totalInteractions > 0 ? Math.ceil(profile.totalInteractions / 10) : 1;
    profile.averageSessionLength =
      (profile.averageSessionLength * (sessions - 1) + durationMs) / sessions;
    profile.updatedAt = Date.now();
  }
}
