import type {
  NeedType,
  CharacterNeed,
  CharacterNeeds,
  NeedTypeDefinition,
  GameEvent,
  Persistable,
} from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { getLogger } from '../core/logger';

/**
 * Expansion 30: Needs System
 *
 * Manages growing internal drives for characters.
 * Needs increase over time and are fulfilled by tools or events.
 */
export class NeedsManager implements Persistable {
  private needs = new Map<string, CharacterNeeds>();
  private needTypes = new Map<string, NeedTypeDefinition>();
  private log = getLogger('needs-manager');

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register a custom need type definition.
   */
  registerNeedType(def: NeedTypeDefinition): void {
    this.needTypes.set(def.type, def);
  }

  /**
   * Get all registered need type definitions.
   */
  getNeedTypes(): NeedTypeDefinition[] {
    return [...this.needTypes.values()];
  }

  /**
   * Get needs for a character. Auto-initializes from registered types if needed.
   */
  getNeeds(characterId: string): CharacterNeeds {
    if (!this.needs.has(characterId)) {
      const needsList: CharacterNeed[] = [];
      for (const def of this.needTypes.values()) {
        needsList.push({
          type: def.type,
          intensity: 0,
          growthRate: def.defaultGrowthRate,
          decayOnFulfill: def.defaultDecayOnFulfill,
          lastFulfilledAt: Date.now(),
        });
      }
      this.needs.set(characterId, { characterId, needs: needsList });
    }
    return this.needs.get(characterId)!;
  }

  /**
   * Get a specific need for a character.
   */
  getNeed(characterId: string, type: NeedType): CharacterNeed | null {
    const charNeeds = this.getNeeds(characterId);
    return charNeeds.needs.find(n => n.type === type) ?? null;
  }

  /**
   * Set the intensity of a specific need directly.
   */
  setNeedIntensity(characterId: string, type: NeedType, intensity: number): void {
    const need = this.getNeed(characterId, type);
    if (need) {
      need.intensity = Math.max(0, Math.min(1, intensity));
    }
  }

  /**
   * Fulfill (reduce) a need by a given amount or by its default decay.
   */
  fulfillNeed(characterId: string, type: NeedType, amount?: number): void {
    const need = this.getNeed(characterId, type);
    if (need) {
      need.intensity = Math.max(0, need.intensity - (amount ?? need.decayOnFulfill));
      need.lastFulfilledAt = Date.now();
    }
  }

  /**
   * Process a tool result — fulfill needs associated with this tool.
   */
  processToolResult(characterId: string, toolName: string): void {
    for (const def of this.needTypes.values()) {
      if (def.fulfillmentTools?.includes(toolName)) {
        this.fulfillNeed(characterId, def.type);
        this.log.debug({ characterId, need: def.type, tool: toolName }, 'Need fulfilled by tool');
      }
    }
  }

  /**
   * Process a game event — fulfill needs associated with this event type.
   */
  processEvent(characterId: string, event: GameEvent): void {
    for (const def of this.needTypes.values()) {
      if (def.fulfillmentEvents?.includes(event.type)) {
        this.fulfillNeed(characterId, def.type);
        this.log.debug({ characterId, need: def.type, event: event.type }, 'Need fulfilled by event');
      }
    }
  }

  /**
   * Grow all needs for all characters by their growth rate.
   * Called on tick:fast.
   */
  growAll(): void {
    for (const [, charNeeds] of this.needs) {
      for (const need of charNeeds.needs) {
        need.intensity = Math.min(1, need.intensity + need.growthRate);
      }
    }
  }

  /**
   * Build a needs prompt for LLM context injection.
   * Only shows needs > 0.3 intensity.
   */
  getNeedsPrompt(characterId: string): string | null {
    const charNeeds = this.needs.get(characterId);
    if (!charNeeds) return null;

    const significant = charNeeds.needs
      .filter(n => n.intensity > 0.3)
      .sort((a, b) => b.intensity - a.intensity);

    if (significant.length === 0) return null;

    const descriptions = significant.slice(0, 3).map(n => {
      const def = this.needTypes.get(n.type);
      const desc = def?.description ?? n.type;
      if (n.intensity > 0.7) return `desperately need ${desc}`;
      if (n.intensity > 0.5) return `really need ${desc}`;
      return `could use some ${desc}`;
    });

    return `Your needs: You ${descriptions.join(' and you ')}.`;
  }

  /**
   * Get critical needs above a threshold.
   */
  getCriticalNeeds(characterId: string, threshold: number = 0.7): CharacterNeed[] {
    const charNeeds = this.needs.get(characterId);
    if (!charNeeds) return [];
    return charNeeds.needs.filter(n => n.intensity >= threshold);
  }

  /**
   * Clear all needs data for a character.
   */
  clearCharacter(characterId: string): void {
    this.needs.delete(characterId);
  }

  // --- Persistence ---

  saveState(repo: StateRepository): void {
    const data: Array<{ characterId: string; needs: string }> = [];
    for (const [characterId, charNeeds] of this.needs) {
      data.push({ characterId, needs: JSON.stringify(charNeeds.needs) });
    }
    repo.clearNeeds();
    if (data.length > 0) repo.saveNeeds(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllNeeds();
    this.needs.clear();
    for (const r of rows) {
      this.needs.set(r.characterId, {
        characterId: r.characterId,
        needs: JSON.parse(r.needs),
      });
    }
    this.log.debug({ count: rows.length }, 'Needs loaded from DB');
  }

  // --- Private ---

  private registerDefaults(): void {
    const defaults: NeedTypeDefinition[] = [
      {
        type: 'rest',
        defaultGrowthRate: 0.003,
        defaultDecayOnFulfill: 0.5,
        description: 'rest',
        fulfillmentTools: ['rest'],
      },
      {
        type: 'social',
        defaultGrowthRate: 0.002,
        defaultDecayOnFulfill: 0.4,
        description: 'company',
        fulfillmentTools: ['talk_to'],
        fulfillmentEvents: ['dialogue', 'meeting'],
      },
      {
        type: 'sustenance',
        defaultGrowthRate: 0.004,
        defaultDecayOnFulfill: 0.6,
        description: 'sustenance',
        fulfillmentEvents: ['trade'],
      },
      {
        type: 'safety',
        defaultGrowthRate: 0.001,
        defaultDecayOnFulfill: 0.5,
        description: 'safety',
        fulfillmentEvents: ['alliance'],
      },
      {
        type: 'purpose',
        defaultGrowthRate: 0.002,
        defaultDecayOnFulfill: 0.4,
        description: 'purpose',
        fulfillmentTools: ['investigate', 'trade'],
        fulfillmentEvents: ['quest_start', 'discovery'],
      },
    ];

    for (const def of defaults) {
      this.needTypes.set(def.type, def);
    }
  }
}
