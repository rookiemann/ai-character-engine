import type {
  RoutineActivity,
  CharacterRoutine,
  Persistable,
} from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { getLogger } from '../core/logger';

/**
 * Expansion 31: Routine System
 *
 * Manages phase-based daily activities for characters.
 * Games provide time phases ('morning', 'evening', etc.) and characters
 * follow routines that define what they do during each phase.
 */
export class RoutineManager implements Persistable {
  private routines = new Map<string, CharacterRoutine[]>(); // characterId → routines
  private currentPhase = '';
  private log = getLogger('routine-manager');

  /**
   * Add a routine for a character.
   */
  addRoutine(
    characterId: string,
    name: string,
    activities: RoutineActivity[],
    conditions?: Record<string, unknown>,
    isDefault?: boolean,
  ): CharacterRoutine {
    const id = `routine_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const routine: CharacterRoutine = {
      id,
      characterId,
      name,
      activities,
      conditions,
      isDefault: isDefault ?? false,
      createdAt: Date.now(),
    };

    if (!this.routines.has(characterId)) {
      this.routines.set(characterId, []);
    }
    this.routines.get(characterId)!.push(routine);

    this.log.debug({ characterId, routineId: id, name }, 'Routine added');
    return routine;
  }

  /**
   * Remove a routine by ID.
   */
  removeRoutine(routineId: string): boolean {
    for (const [characterId, routines] of this.routines) {
      const idx = routines.findIndex(r => r.id === routineId);
      if (idx !== -1) {
        routines.splice(idx, 1);
        if (routines.length === 0) this.routines.delete(characterId);
        return true;
      }
    }
    return false;
  }

  /**
   * Get all routines for a character.
   */
  getRoutines(characterId: string): CharacterRoutine[] {
    return this.routines.get(characterId) ?? [];
  }

  /**
   * Update the current time phase. Stores the new phase.
   */
  updatePhase(phase: string): void {
    const normalized = phase?.toLowerCase();
    if (normalized && normalized !== this.currentPhase) {
      this.currentPhase = normalized;
    }
  }

  /**
   * Get the current time phase.
   */
  getCurrentPhase(): string {
    return this.currentPhase;
  }

  /**
   * Get the active routine for a character.
   * Checks conditional routines first (all conditions must match gameState keys),
   * falls back to default routine.
   */
  getActiveRoutine(characterId: string, gameState?: Record<string, unknown>): CharacterRoutine | null {
    const routines = this.routines.get(characterId);
    if (!routines || routines.length === 0) return null;

    // Check conditional routines first
    if (gameState) {
      for (const routine of routines) {
        if (routine.conditions && !routine.isDefault) {
          const matches = Object.entries(routine.conditions).every(
            ([key, value]) => gameState[key] === value,
          );
          if (matches) return routine;
        }
      }
    }

    // Fallback to default routine
    return routines.find(r => r.isDefault) ?? routines[0];
  }

  /**
   * Get the current activity for a character based on current phase.
   */
  getCurrentActivity(characterId: string): RoutineActivity | null {
    if (!this.currentPhase) return null;

    const routine = this.getActiveRoutine(characterId);
    if (!routine) return null;

    // Find matching activities for current phase, pick highest priority
    const matching = routine.activities
      .filter(a => a.phase.toLowerCase() === this.currentPhase)
      .sort((a, b) => b.priority - a.priority);

    return matching[0] ?? null;
  }

  /**
   * Build a routine prompt for LLM context injection.
   */
  getRoutinePrompt(characterId: string): string | null {
    const activity = this.getCurrentActivity(characterId);
    if (!activity) return null;

    const locationPart = activity.location ? ` at ${activity.location}` : '';
    return `Your routine: You normally spend ${activity.phase}s ${activity.activity}${locationPart}. It is currently ${this.currentPhase}.`;
  }

  /**
   * Clear all routine data for a character.
   */
  clearCharacter(characterId: string): void {
    this.routines.delete(characterId);
  }

  // --- Persistence ---

  saveState(repo: StateRepository): void {
    const data: Array<{
      id: string; characterId: string; name: string; activities: string;
      conditions?: string; isDefault: boolean; createdAt: number;
    }> = [];
    for (const [, routines] of this.routines) {
      for (const r of routines) {
        data.push({
          id: r.id,
          characterId: r.characterId,
          name: r.name,
          activities: JSON.stringify(r.activities),
          conditions: r.conditions ? JSON.stringify(r.conditions) : undefined,
          isDefault: r.isDefault,
          createdAt: r.createdAt,
        });
      }
    }
    repo.clearRoutines();
    if (data.length > 0) repo.saveRoutines(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllRoutines();
    this.routines.clear();
    for (const r of rows) {
      const routine: CharacterRoutine = {
        id: r.id,
        characterId: r.characterId,
        name: r.name,
        activities: JSON.parse(r.activities),
        conditions: r.conditions ? JSON.parse(r.conditions) : undefined,
        isDefault: r.isDefault,
        createdAt: r.createdAt,
      };
      if (!this.routines.has(r.characterId)) {
        this.routines.set(r.characterId, []);
      }
      this.routines.get(r.characterId)!.push(routine);
    }
    this.log.debug({ count: rows.length }, 'Routines loaded from DB');
  }
}
