import { getRawDatabase } from './database';
import type { StateRepository } from './repositories/StateRepository';
import { getLogger } from '../core/logger';

export interface Persistable {
  saveState(repo: StateRepository): void;
  loadState(repo: StateRepository): void;
}

/**
 * StatePersistence — coordinator for save/load/export/import of all expansion state.
 * Wraps all operations in SQLite transactions for atomicity.
 */
export class StatePersistence {
  private managers: Persistable[] = [];
  private log = getLogger('state-persistence');

  constructor(private repo: StateRepository) {}

  /**
   * Register a persistable manager.
   */
  register(manager: Persistable): void {
    this.managers.push(manager);
  }

  /**
   * Save all registered managers' state in one transaction.
   */
  saveAll(): void {
    const raw = getRawDatabase();
    const txn = raw.transaction(() => {
      for (const manager of this.managers) {
        manager.saveState(this.repo);
      }
    });
    txn();
    this.log.debug({ managers: this.managers.length }, 'All state saved');
  }

  /**
   * Load all registered managers' state from DB.
   */
  loadAll(): void {
    for (const manager of this.managers) {
      manager.loadState(this.repo);
    }
    this.log.debug({ managers: this.managers.length }, 'All state loaded');
  }

  /**
   * Save all state + record a snapshot.
   */
  saveSnapshot(name?: string): string {
    const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const snapshotName = name ?? `snapshot-${new Date().toISOString()}`;

    const raw = getRawDatabase();
    const txn = raw.transaction(() => {
      for (const manager of this.managers) {
        manager.saveState(this.repo);
      }
      this.repo.createSnapshot(id, snapshotName, '', { managers: this.managers.length });
    });
    txn();

    this.log.info({ id, name: snapshotName }, 'Snapshot saved');
    return id;
  }

  /**
   * List all saved snapshots.
   */
  listSnapshots(): Array<{ id: string; name: string; description: string; createdAt: number }> {
    return this.repo.listSnapshots();
  }

  /**
   * Export all expansion state as a JSON-serializable object.
   */
  exportState(): Record<string, unknown> {
    // Save current in-memory state to DB first
    this.saveAll();

    return {
      emotions: this.repo.loadAllEmotions(),
      relationships: this.repo.loadAllRelationships(),
      goals: this.repo.loadAllGoals(),
      worldFacts: this.repo.loadAllWorldFacts(),
      playerProfiles: this.repo.loadAllPlayerProfiles(),
      groups: this.repo.loadAllGroups(),
      playerSessions: this.repo.loadAllPlayerSessions(),
      recentActions: this.repo.loadAllRecentActions(),
      perceptions: this.repo.loadAllPerceptions(),
      needs: this.repo.loadAllNeeds(),
      routines: this.repo.loadAllRoutines(),
      deathRecords: this.repo.loadAllDeathRecords(),
      gossipItems: this.repo.loadAllGossipItems(),
      characterGossip: this.repo.loadAllCharacterGossip(),
      reputation: this.repo.loadAllReputation(),
      reputationEvents: this.repo.loadAllReputationEvents(),
      hierarchyDefinitions: this.repo.loadAllHierarchyDefinitions(),
      hierarchyMemberships: this.repo.loadAllHierarchyMemberships(),
      hierarchyOrders: this.repo.loadAllHierarchyOrders(),
      exportedAt: Date.now(),
    };
  }

  /**
   * Import state from an exported JSON object.
   * Clears existing expansion tables, writes imported data, reloads in-memory.
   */
  importState(data: Record<string, unknown>): void {
    const raw = getRawDatabase();
    const txn = raw.transaction(() => {
      // Clear all tables
      this.repo.clearEmotions();
      this.repo.clearRelationships();
      this.repo.clearGoals();
      this.repo.clearWorldFacts();
      this.repo.clearPlayerProfiles();
      this.repo.clearGroups();
      this.repo.clearPlayerSessions();
      this.repo.clearRecentActions();
      this.repo.clearPerceptions();
      this.repo.clearNeeds();
      this.repo.clearRoutines();
      this.repo.clearDeathRecords();
      this.repo.clearGossipItems();
      this.repo.clearCharacterGossip();
      this.repo.clearReputation();
      this.repo.clearReputationEvents();
      this.repo.clearHierarchyDefinitions();
      this.repo.clearHierarchyMemberships();
      this.repo.clearHierarchyOrders();

      // Write imported data
      if (Array.isArray(data.emotions)) this.repo.saveEmotions(data.emotions as any);
      if (Array.isArray(data.relationships)) this.repo.saveRelationships(data.relationships as any);
      if (Array.isArray(data.goals)) this.repo.saveGoals(data.goals as any);
      if (Array.isArray(data.worldFacts)) this.repo.saveWorldFacts(data.worldFacts as any);
      if (Array.isArray(data.playerProfiles)) this.repo.savePlayerProfiles(data.playerProfiles as any);
      if (Array.isArray(data.groups)) this.repo.saveGroups(data.groups as any);
      if (Array.isArray(data.playerSessions)) this.repo.savePlayerSessions(data.playerSessions as any);
      if (Array.isArray(data.recentActions)) this.repo.saveRecentActions(data.recentActions as any);
      if (Array.isArray(data.perceptions)) this.repo.savePerceptions(data.perceptions as any);
      if (Array.isArray(data.needs)) this.repo.saveNeeds(data.needs as any);
      if (Array.isArray(data.routines)) this.repo.saveRoutines(data.routines as any);
      if (Array.isArray(data.deathRecords)) this.repo.saveDeathRecords(data.deathRecords as any);
      if (Array.isArray(data.gossipItems)) this.repo.saveGossipItems(data.gossipItems as any);
      if (Array.isArray(data.characterGossip)) this.repo.saveCharacterGossip(data.characterGossip as any);
      if (Array.isArray(data.reputation)) this.repo.saveReputation(data.reputation as any);
      if (Array.isArray(data.reputationEvents)) this.repo.saveReputationEvents(data.reputationEvents as any);
      if (Array.isArray(data.hierarchyDefinitions)) this.repo.saveHierarchyDefinitions(data.hierarchyDefinitions as any);
      if (Array.isArray(data.hierarchyMemberships)) this.repo.saveHierarchyMemberships(data.hierarchyMemberships as any);
      if (Array.isArray(data.hierarchyOrders)) this.repo.saveHierarchyOrders(data.hierarchyOrders as any);
    });
    txn();

    // Reload in-memory state
    this.loadAll();
    this.log.info('State imported successfully');
  }
}
