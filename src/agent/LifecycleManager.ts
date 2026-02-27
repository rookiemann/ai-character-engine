import type {
  CharacterState,
  CharacterDeathRecord,
  CharacterDefinition,
  LifecycleConfig,
  GameEvent,
  Persistable,
} from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import type { TypedEventEmitter } from '../core/events';
import type { AgentRegistry } from './AgentRegistry';
import type { EmotionManager } from './EmotionManager';
import type { RelationshipManager } from './RelationshipManager';
import type { GoalPlanner } from './GoalPlanner';
import type { GroupManager } from './GroupManager';
import type { RoutineManager } from './RoutineManager';
import type { NeedsManager } from './NeedsManager';
import type { PerceptionManager } from './PerceptionManager';
import type { GossipManager } from './GossipManager';
import type { ReputationManager } from './ReputationManager';
import type { HierarchyManager } from './HierarchyManager';
import type { ProximityManager } from '../proximity/ProximityManager';
import type { MemoryManager } from '../memory/MemoryManager';
import type { GamePlugin } from '../plugin/GamePlugin';
import type { ToolRegistry } from '../tools/ToolRegistry';
import { getLogger } from '../core/logger';

export interface LifecycleSubsystems {
  emotions: EmotionManager;
  relationships: RelationshipManager;
  goals: GoalPlanner;
  groups: GroupManager;
  routines: RoutineManager;
  needs: NeedsManager;
  perception: PerceptionManager;
  gossip?: GossipManager;
  reputation?: ReputationManager;
  hierarchy?: HierarchyManager;
  plugin?: GamePlugin | null;
  proximity: ProximityManager;
  memory: MemoryManager;
  runner?: { clearCharacter(characterId: string): void };
  tools?: ToolRegistry;
}

/**
 * Expansion 32: Lifecycle System
 *
 * Manages character death, cleanup of all subsystem state,
 * and automatic respawning to maintain population.
 */
export class LifecycleManager implements Persistable {
  private deathRecords: CharacterDeathRecord[] = [];
  private static readonly MAX_DEATH_RECORDS = 500;
  private config: LifecycleConfig;
  private targetPopulation: number = 0;
  private pendingRespawns: Array<{ diedCharId: string; scheduledAt: number }> = [];
  private log = getLogger('lifecycle-manager');

  constructor(
    private registry: AgentRegistry,
    private emitter: TypedEventEmitter,
    config?: Partial<LifecycleConfig>,
  ) {
    this.config = {
      respawnDelayMs: config?.respawnDelayMs ?? 30000,
      enableAutoRespawn: config?.enableAutoRespawn ?? true,
      targetPopulation: config?.targetPopulation,
    };
  }

  /**
   * Kill a character: record death, clean up all subsystems, emit event.
   */
  killCharacter(
    characterId: string,
    cause: string,
    subsystems: LifecycleSubsystems,
  ): CharacterDeathRecord | null {
    const character = this.registry.get(characterId);
    if (!character) {
      this.log.warn({ characterId }, 'Cannot kill unknown character');
      return null;
    }

    // Record death
    const record: CharacterDeathRecord = {
      characterId,
      characterName: character.name,
      cause,
      timestamp: Date.now(),
    };
    this.deathRecords.push(record);
    // Cap death records to prevent unbounded growth
    if (this.deathRecords.length > LifecycleManager.MAX_DEATH_RECORDS) {
      this.deathRecords = this.deathRecords.slice(-LifecycleManager.MAX_DEATH_RECORDS);
    }

    // Clean up subsystem state
    subsystems.emotions.clearCharacter(characterId);
    subsystems.goals.clearCharacter(characterId);
    subsystems.routines.clearCharacter(characterId);
    subsystems.needs.clearCharacter(characterId);
    subsystems.perception.clearCharacter(characterId);
    subsystems.gossip?.clearCharacter(characterId);
    subsystems.reputation?.clearCharacter(characterId);

    // Remove relationships involving this character
    subsystems.relationships.clearCharacter(characterId);

    // Remove from groups
    const groups = subsystems.groups.getCharacterGroups(characterId);
    for (const group of groups) {
      subsystems.groups.removeMember(group.id, characterId);
    }

    // Handle hierarchy succession before removal
    if (subsystems.hierarchy) {
      const factions = subsystems.hierarchy.getCharacterFactions(characterId);
      for (const membership of factions) {
        subsystems.hierarchy.handleSuccession(characterId, membership.factionId, subsystems.plugin ?? null);
      }
      subsystems.hierarchy.clearCharacter(characterId);
    }

    // Clear proximity
    subsystems.proximity.clearScore(characterId, 'default');

    // Clear runner recency/rotation tracking and tool cooldowns
    subsystems.runner?.clearCharacter(characterId);
    subsystems.tools?.clearCharacterCooldowns(characterId);

    // Remove from registry
    this.registry.remove(characterId);

    this.emitter.emit('character:died', characterId, cause);
    this.log.info({ characterId, name: character.name, cause }, 'Character died');

    // Schedule respawn if enabled
    if (this.config.enableAutoRespawn && this.getPopulation() < this.targetPopulation) {
      this.pendingRespawns.push({
        diedCharId: characterId,
        scheduledAt: Date.now() + this.config.respawnDelayMs,
      });
    }

    return record;
  }

  /**
   * Spawn a replacement character for one that died.
   */
  spawnReplacement(
    diedCharId: string,
    plugin: GamePlugin | null,
    playerId: string = 'default',
  ): CharacterState | null {
    let def: CharacterDefinition | null = null;

    // 1. Ask plugin for replacement
    if (plugin?.spawnReplacement) {
      def = plugin.spawnReplacement(diedCharId);
    }

    // 2. Fallback: random archetype from plugin
    if (!def && plugin) {
      const archetypes = plugin.getArchetypes();
      if (archetypes.length > 0) {
        const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];
        const suffix = Math.random().toString(36).slice(2, 6);
        def = {
          id: `char_${Date.now()}_${suffix}`,
          name: `${archetype.name} ${suffix.toUpperCase()}`,
          archetype: archetype.id,
          identity: { ...archetype.defaultIdentity },
        };
      }
    }

    if (!def) {
      this.log.warn({ diedCharId }, 'No replacement definition available');
      return null;
    }

    // Register the new character
    const newState = this.registry.register(def, playerId);

    // Notify plugin
    plugin?.onCharacterAdded?.(newState);

    // Update death record
    const record = this.deathRecords.find(r => r.characterId === diedCharId && !r.replacedBy);
    if (record) {
      record.replacedBy = newState.id;
    }

    this.emitter.emit('character:spawned', newState, diedCharId);
    this.log.info({ newId: newState.id, name: newState.name, replacedId: diedCharId }, 'Character spawned');

    return newState;
  }

  /**
   * Process a character_death game event.
   */
  processDeathEvent(
    event: GameEvent,
    plugin: GamePlugin | null,
    subsystems: LifecycleSubsystems,
  ): void {
    const characterId = event.target ?? (event.data?.characterId as string);
    const cause = (event.data?.cause as string) ?? event.type;
    if (!characterId) return;

    this.killCharacter(characterId, cause, subsystems);
  }

  /**
   * Process pending respawns whose delay has elapsed.
   */
  processPendingRespawns(plugin: GamePlugin | null, playerId: string = 'default'): void {
    const now = Date.now();
    const ready = this.pendingRespawns.filter(r => r.scheduledAt <= now);

    for (const pending of ready) {
      this.spawnReplacement(pending.diedCharId, plugin, playerId);
    }

    this.pendingRespawns = this.pendingRespawns.filter(r => r.scheduledAt > now);
  }

  /**
   * Get current population count.
   */
  getPopulation(): number {
    return this.registry.getAll().length;
  }

  /**
   * Set the target population for auto-respawn.
   */
  setTargetPopulation(target: number): void {
    this.targetPopulation = target;
  }

  /**
   * Get all death records.
   */
  getDeathRecords(): CharacterDeathRecord[] {
    return [...this.deathRecords];
  }

  // --- Persistence ---

  saveState(repo: StateRepository): void {
    repo.clearDeathRecords();
    if (this.deathRecords.length > 0) {
      repo.saveDeathRecords(this.deathRecords.map(r => ({
        characterId: r.characterId,
        characterName: r.characterName,
        cause: r.cause,
        timestamp: r.timestamp,
        replacedBy: r.replacedBy,
      })));
    }
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllDeathRecords();
    this.deathRecords = rows.map(r => ({
      characterId: r.characterId,
      characterName: r.characterName,
      cause: r.cause,
      timestamp: r.timestamp,
      replacedBy: r.replacedBy,
    }));
    this.log.debug({ count: rows.length }, 'Death records loaded from DB');
  }
}
