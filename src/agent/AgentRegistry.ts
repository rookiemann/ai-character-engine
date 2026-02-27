import type { CharacterDefinition, CharacterState, ProximityScore, ActivityTier } from '../core/types';
import { CharacterRepository } from '../db/repositories/CharacterRepository';
import { ProximityRepository } from '../db/repositories/ProximityRepository';
import { TypedEventEmitter } from '../core/events';
import { getLogger } from '../core/logger';

function closenessToTier(closeness: number): ActivityTier {
  if (closeness >= 60) return 'active';
  if (closeness >= 20) return 'background';
  return 'dormant';
}

/**
 * Manages character registration, storage, and retrieval.
 * Wraps CharacterRepository with event emission and caching.
 */
export class AgentRegistry {
  private cache = new Map<string, CharacterState>();
  private log = getLogger('agent-registry');

  constructor(
    private charRepo: CharacterRepository,
    private proxRepo: ProximityRepository,
    private emitter: TypedEventEmitter,
  ) {}

  /**
   * Register a new character. Creates both character record and initial proximity.
   */
  register(def: CharacterDefinition, playerId: string = 'default'): CharacterState {
    const state = this.charRepo.create(def);

    // Compute initial tier from closeness
    const initialCloseness = def.initialCloseness ?? 0;
    const initialTier = closenessToTier(initialCloseness);

    // Sync character record with correct tier
    if (initialTier !== 'dormant') {
      this.charRepo.update(state.id, { activityTier: initialTier, closeness: initialCloseness });
      state.activityTier = initialTier;
    }

    // Create initial proximity score
    this.proxRepo.upsert({
      characterId: state.id,
      playerId,
      closeness: initialCloseness,
      highWaterMark: initialCloseness,
      activityTier: initialTier,
      lastInteractionAt: Date.now(),
      totalInteractions: 0,
      updatedAt: Date.now(),
    });

    this.cache.set(state.id, state);
    this.emitter.emit('character:registered', state);
    this.log.info({ id: state.id, name: state.name, archetype: state.archetype, tier: initialTier }, 'Character registered');

    return state;
  }

  /**
   * Get a character by ID.
   */
  get(id: string): CharacterState | null {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    const state = this.charRepo.getById(id);
    if (state) {
      this.cache.set(id, state);
    }
    return state;
  }

  /**
   * Get all registered characters.
   */
  getAll(): CharacterState[] {
    const all = this.charRepo.getAll();
    for (const s of all) {
      this.cache.set(s.id, s);
    }
    return all;
  }

  /**
   * Get characters by activity tier.
   */
  getByTier(tier: string): CharacterState[] {
    return this.charRepo.getByTier(tier);
  }

  /**
   * Update character state (closeness, tier, etc.).
   */
  update(id: string, updates: Partial<Pick<CharacterState, 'activityTier' | 'closeness' | 'highWaterMark' | 'metadata'>>): void {
    this.charRepo.update(id, updates);

    // Invalidate cache
    const cached = this.cache.get(id);
    if (cached) {
      Object.assign(cached, updates, { updatedAt: Date.now() });
    }
  }

  /**
   * Remove a character.
   */
  remove(id: string): void {
    this.charRepo.delete(id);
    this.cache.delete(id);
    this.emitter.emit('character:removed', id);
    this.log.info({ id }, 'Character removed');
  }

  /**
   * Clear the in-memory cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
