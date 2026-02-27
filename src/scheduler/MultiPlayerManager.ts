import type { ActivityTier, Persistable } from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { ProximityManager } from '../proximity/ProximityManager';
import { MemoryManager } from '../memory/MemoryManager';
import { AgentRegistry } from '../agent/AgentRegistry';
import { getLogger } from '../core/logger';

/**
 * Expansion 16: Multi-Player Support
 *
 * Manages state separation and coordination for multiple simultaneous players.
 * Each player has independent proximity scores, memory contexts, and chat histories.
 */
export class MultiPlayerManager implements Persistable {
  private activePlayers = new Map<string, PlayerSession>();
  private log = getLogger('multi-player');

  constructor(
    private registry: AgentRegistry,
    private proximity: ProximityManager,
    private memory: MemoryManager,
  ) {}

  /**
   * Register a player session.
   */
  joinPlayer(playerId: string): PlayerSession {
    if (this.activePlayers.has(playerId)) {
      return this.activePlayers.get(playerId)!;
    }

    const session: PlayerSession = {
      playerId,
      joinedAt: Date.now(),
      lastActiveAt: Date.now(),
      characterInteractions: new Map(),
    };

    this.activePlayers.set(playerId, session);

    // Initialize proximity scores for all characters for this player
    const allChars = this.registry.getAll();
    for (const char of allChars) {
      const existing = this.proximity.getScore(char.id, playerId);
      if (!existing) {
        this.proximity.boostFromEvent(char.id, playerId, char.closeness > 0 ? char.closeness : 0);
      }
    }

    this.log.info({ playerId, characters: allChars.length }, 'Player joined');
    return session;
  }

  /**
   * Remove a player session.
   */
  leavePlayer(playerId: string): void {
    this.activePlayers.delete(playerId);
    this.log.info({ playerId }, 'Player left');
  }

  /**
   * Get all active player IDs.
   */
  getActivePlayers(): string[] {
    return [...this.activePlayers.keys()];
  }

  /**
   * Get characters that are active for a specific player.
   */
  getActiveCharactersForPlayer(playerId: string): string[] {
    const allChars = this.registry.getAll();
    return allChars
      .filter(c => {
        const score = this.proximity.getScore(c.id, playerId);
        return score && score.activityTier === 'active';
      })
      .map(c => c.id);
  }

  /**
   * Get the activity tier of a character relative to a specific player.
   */
  getCharacterTierForPlayer(characterId: string, playerId: string): ActivityTier {
    const score = this.proximity.getScore(characterId, playerId);
    return score?.activityTier ?? 'dormant';
  }

  /**
   * Record that a player interacted with a character.
   */
  recordInteraction(playerId: string, characterId: string): void {
    const session = this.activePlayers.get(playerId);
    if (!session) return;

    session.lastActiveAt = Date.now();
    const count = session.characterInteractions.get(characterId) ?? 0;
    session.characterInteractions.set(characterId, count + 1);
  }

  /**
   * Get player session info.
   */
  getSession(playerId: string): PlayerSession | undefined {
    return this.activePlayers.get(playerId);
  }

  /**
   * Prune inactive player sessions.
   */
  pruneInactive(maxIdleMs: number = 30 * 60 * 1000): string[] {
    const pruned: string[] = [];
    const cutoff = Date.now() - maxIdleMs;

    for (const [playerId, session] of this.activePlayers) {
      if (session.lastActiveAt < cutoff) {
        this.activePlayers.delete(playerId);
        pruned.push(playerId);
      }
    }

    if (pruned.length > 0) {
      this.log.info({ pruned: pruned.length }, 'Inactive players pruned');
    }

    return pruned;
  }

  /**
   * Get count of active players.
   */
  get playerCount(): number {
    return this.activePlayers.size;
  }

  saveState(repo: StateRepository): void {
    const data: Array<{
      playerId: string; joinedAt: number; lastActiveAt: number;
      characterInteractions: string;
    }> = [];
    for (const session of this.activePlayers.values()) {
      const interactions: Record<string, number> = {};
      for (const [charId, count] of session.characterInteractions) {
        interactions[charId] = count;
      }
      data.push({
        playerId: session.playerId,
        joinedAt: session.joinedAt,
        lastActiveAt: session.lastActiveAt,
        characterInteractions: JSON.stringify(interactions),
      });
    }
    repo.clearPlayerSessions();
    if (data.length > 0) repo.savePlayerSessions(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllPlayerSessions();
    this.activePlayers.clear();
    for (const r of rows) {
      const interactions = new Map<string, number>();
      const parsed = JSON.parse(r.characterInteractions) as Record<string, number>;
      for (const [charId, count] of Object.entries(parsed)) {
        interactions.set(charId, count);
      }
      this.activePlayers.set(r.playerId, {
        playerId: r.playerId,
        joinedAt: r.joinedAt,
        lastActiveAt: r.lastActiveAt,
        characterInteractions: interactions,
      });
    }
    this.log.debug({ count: rows.length }, 'Player sessions loaded from DB');
  }
}

export interface PlayerSession {
  playerId: string;
  joinedAt: number;
  lastActiveAt: number;
  characterInteractions: Map<string, number>;
}
