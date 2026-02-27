import type {
  PerceptionEntry,
  CharacterPerception,
  GameEvent,
  Persistable,
} from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import type { AgentRegistry } from './AgentRegistry';
import { getLogger } from '../core/logger';

/**
 * Expansion 29: Perception System
 *
 * Tracks character locations and filters events by spatial proximity.
 * Characters can only perceive events and other characters at the same location.
 */
export class PerceptionManager implements Persistable {
  private perceptions = new Map<string, CharacterPerception>();
  private locationIndex = new Map<string, Set<string>>(); // location → characterIds
  private static MAX_RECENT = 10;
  private log = getLogger('perception-manager');

  constructor(private registry: AgentRegistry) {}

  /**
   * Update a character's location. Rebuilds nearbyCharacters for affected locations.
   */
  updateLocation(characterId: string, location: string): void {
    const perception = this.getOrCreate(characterId);
    const oldLocation = perception.location;

    if (oldLocation === location) return;

    // Remove from old location index
    if (oldLocation) {
      const oldSet = this.locationIndex.get(oldLocation);
      if (oldSet) {
        oldSet.delete(characterId);
        if (oldSet.size === 0) this.locationIndex.delete(oldLocation);
      }
    }

    // Add to new location index
    if (location) {
      if (!this.locationIndex.has(location)) {
        this.locationIndex.set(location, new Set());
      }
      this.locationIndex.get(location)!.add(characterId);
    }

    perception.location = location;
    perception.updatedAt = Date.now();

    // Rebuild nearbyCharacters for all chars at old and new locations
    this.rebuildNearby(oldLocation);
    this.rebuildNearby(location);
  }

  /**
   * Get all character IDs at a given location.
   */
  getCharactersAtLocation(location: string): string[] {
    const set = this.locationIndex.get(location);
    return set ? [...set] : [];
  }

  /**
   * Get a character's current location.
   */
  getLocation(characterId: string): string | null {
    return this.perceptions.get(characterId)?.location || null;
  }

  /**
   * Filter event candidates to only those who can perceive the event (same location).
   * Events without a location pass through to all candidates (broadcast).
   */
  filterByPerception(event: GameEvent, candidateIds: string[]): string[] {
    const eventLocation = event.data?.location as string | undefined;
    if (!eventLocation) return candidateIds; // broadcast

    return candidateIds.filter(id => {
      const perception = this.perceptions.get(id);
      return perception?.location === eventLocation;
    });
  }

  /**
   * Record a perception entry for a character.
   */
  recordPerception(characterId: string, entry: PerceptionEntry): void {
    const perception = this.getOrCreate(characterId);
    perception.recentPerceptions.push(entry);
    if (perception.recentPerceptions.length > PerceptionManager.MAX_RECENT) {
      perception.recentPerceptions.shift();
    }
    perception.updatedAt = Date.now();
  }

  /**
   * Get recent perceptions for a character.
   */
  getRecentPerceptions(characterId: string, limit: number = 5): PerceptionEntry[] {
    const perception = this.perceptions.get(characterId);
    if (!perception) return [];
    return perception.recentPerceptions.slice(-limit);
  }

  /**
   * Build a perception prompt for LLM context injection.
   */
  getPerceptionPrompt(characterId: string): string | null {
    const perception = this.perceptions.get(characterId);
    if (!perception) return null;

    const parts: string[] = [];

    // Nearby characters
    if (perception.nearbyCharacters.length > 0) {
      const names = perception.nearbyCharacters
        .map(id => this.registry.get(id)?.name ?? id)
        .slice(0, 5);
      parts.push(`Nearby: ${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} here.`);
    }

    // Recent perceptions (last 3)
    const recent = perception.recentPerceptions.slice(-3);
    if (recent.length > 0) {
      const descs = recent.map(p => p.description);
      parts.push(`You recently noticed: ${descs.join('; ')}.`);
    }

    return parts.length > 0 ? parts.join(' ') : null;
  }

  /**
   * Get all locations and their character IDs.
   */
  getAllLocations(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [location, charIds] of this.locationIndex) {
      result.set(location, [...charIds]);
    }
    return result;
  }

  /**
   * Clear all perception data for a character.
   */
  clearCharacter(characterId: string): void {
    const perception = this.perceptions.get(characterId);
    if (perception?.location) {
      const set = this.locationIndex.get(perception.location);
      if (set) {
        set.delete(characterId);
        if (set.size === 0) this.locationIndex.delete(perception.location);
      }
      this.rebuildNearby(perception.location);
    }
    this.perceptions.delete(characterId);
  }

  // --- Persistence ---

  saveState(repo: StateRepository): void {
    const data: Array<{
      characterId: string; location: string; nearbyCharacters: string; recentPerceptions: string;
    }> = [];
    for (const [characterId, p] of this.perceptions) {
      data.push({
        characterId,
        location: p.location,
        nearbyCharacters: JSON.stringify(p.nearbyCharacters),
        recentPerceptions: JSON.stringify(p.recentPerceptions),
      });
    }
    repo.clearPerceptions();
    if (data.length > 0) repo.savePerceptions(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllPerceptions();
    this.perceptions.clear();
    this.locationIndex.clear();
    for (const r of rows) {
      const nearbyCharacters = JSON.parse(r.nearbyCharacters) as string[];
      const recentPerceptions = JSON.parse(r.recentPerceptions) as PerceptionEntry[];
      this.perceptions.set(r.characterId, {
        characterId: r.characterId,
        location: r.location,
        nearbyCharacters,
        recentPerceptions,
        updatedAt: Date.now(),
      });
      // Rebuild location index
      if (r.location) {
        if (!this.locationIndex.has(r.location)) {
          this.locationIndex.set(r.location, new Set());
        }
        this.locationIndex.get(r.location)!.add(r.characterId);
      }
    }
    this.log.debug({ count: rows.length }, 'Perceptions loaded from DB');
  }

  // --- Private ---

  private getOrCreate(characterId: string): CharacterPerception {
    if (!this.perceptions.has(characterId)) {
      this.perceptions.set(characterId, {
        characterId,
        location: '',
        nearbyCharacters: [],
        recentPerceptions: [],
        updatedAt: Date.now(),
      });
    }
    return this.perceptions.get(characterId)!;
  }

  private rebuildNearby(location: string): void {
    if (!location) return;
    const charIds = this.getCharactersAtLocation(location);
    for (const id of charIds) {
      const p = this.perceptions.get(id);
      if (p) {
        p.nearbyCharacters = charIds.filter(c => c !== id);
      }
    }
  }
}
