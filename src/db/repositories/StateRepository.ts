import type { DB } from '../database';
import { getRawDatabase } from '../database';
import { getLogger } from '../../core/logger';

/**
 * StateRepository — single repository for all expansion state persistence.
 * All saves use SQLite transactions for atomicity.
 */
export class StateRepository {
  private log = getLogger('state-repo');

  constructor(private db: DB) {}

  private raw() {
    return getRawDatabase();
  }

  // --- Emotions ---

  saveEmotions(data: Array<{ characterId: string; activeEmotions: string; mood: string; moodIntensity: number }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_emotions (character_id, active_emotions, mood, mood_intensity, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    for (const row of data) {
      stmt.run(row.characterId, row.activeEmotions, row.mood, row.moodIntensity, now);
    }
  }

  loadAllEmotions(): Array<{ characterId: string; activeEmotions: string; mood: string; moodIntensity: number }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_emotions').all() as any[];
    return rows.map(r => ({
      characterId: r.character_id,
      activeEmotions: r.active_emotions,
      mood: r.mood,
      moodIntensity: r.mood_intensity,
    }));
  }

  clearEmotions(): void {
    this.raw().exec('DELETE FROM character_emotions');
  }

  // --- Relationships ---

  saveRelationships(data: Array<{
    fromId: string; toId: string; type: string; strength: number;
    trust: number; notes: string; lastInteractionAt: number; updatedAt: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_relationships (from_id, to_id, type, strength, trust, notes, last_interaction_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.fromId, r.toId, r.type, r.strength, r.trust, r.notes, r.lastInteractionAt, r.updatedAt);
    }
  }

  loadAllRelationships(): Array<{
    fromId: string; toId: string; type: string; strength: number;
    trust: number; notes: string; lastInteractionAt: number; updatedAt: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_relationships').all() as any[];
    return rows.map(r => ({
      fromId: r.from_id,
      toId: r.to_id,
      type: r.type,
      strength: r.strength,
      trust: r.trust,
      notes: r.notes,
      lastInteractionAt: r.last_interaction_at,
      updatedAt: r.updated_at,
    }));
  }

  clearRelationships(): void {
    this.raw().exec('DELETE FROM character_relationships');
  }

  // --- Goals ---

  saveGoals(data: Array<{
    id: string; characterId: string; description: string; priority: number;
    status: string; steps: string; parentGoalId?: string; deadline?: number;
    createdAt: number; completedAt?: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_goals (id, character_id, description, priority, status, steps, parent_goal_id, deadline, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const g of data) {
      stmt.run(g.id, g.characterId, g.description, g.priority, g.status, g.steps, g.parentGoalId ?? null, g.deadline ?? null, g.createdAt, g.completedAt ?? null);
    }
  }

  loadAllGoals(): Array<{
    id: string; characterId: string; description: string; priority: number;
    status: string; steps: string; parentGoalId?: string; deadline?: number;
    createdAt: number; completedAt?: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_goals').all() as any[];
    return rows.map(r => ({
      id: r.id,
      characterId: r.character_id,
      description: r.description,
      priority: r.priority,
      status: r.status,
      steps: r.steps,
      parentGoalId: r.parent_goal_id ?? undefined,
      deadline: r.deadline ?? undefined,
      createdAt: r.created_at,
      completedAt: r.completed_at ?? undefined,
    }));
  }

  clearGoals(): void {
    this.raw().exec('DELETE FROM character_goals');
  }

  // --- World Facts ---

  saveWorldFacts(data: Array<{
    key: string; value: string; category: string; source: string;
    confidence: number; updatedAt: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO world_facts (key, value, category, source, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const f of data) {
      stmt.run(f.key, f.value, f.category, f.source, f.confidence, f.updatedAt);
    }
  }

  loadAllWorldFacts(): Array<{
    key: string; value: string; category: string; source: string;
    confidence: number; updatedAt: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM world_facts').all() as any[];
    return rows.map(r => ({
      key: r.key,
      value: r.value,
      category: r.category,
      source: r.source,
      confidence: r.confidence,
      updatedAt: r.updated_at,
    }));
  }

  clearWorldFacts(): void {
    this.raw().exec('DELETE FROM world_facts');
  }

  // --- Player Profiles ---

  savePlayerProfiles(data: Array<{
    playerId: string; preferences: string; interactionPatterns: string;
    totalInteractions: number; averageSessionLength: number;
    lastSeenAt: number; updatedAt: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO player_profiles (player_id, preferences, interaction_patterns, total_interactions, average_session_length, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of data) {
      stmt.run(p.playerId, p.preferences, p.interactionPatterns, p.totalInteractions, p.averageSessionLength, p.lastSeenAt, p.updatedAt);
    }
  }

  loadAllPlayerProfiles(): Array<{
    playerId: string; preferences: string; interactionPatterns: string;
    totalInteractions: number; averageSessionLength: number;
    lastSeenAt: number; updatedAt: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM player_profiles').all() as any[];
    return rows.map(r => ({
      playerId: r.player_id,
      preferences: r.preferences,
      interactionPatterns: r.interaction_patterns,
      totalInteractions: r.total_interactions,
      averageSessionLength: r.average_session_length,
      lastSeenAt: r.last_seen_at,
      updatedAt: r.updated_at,
    }));
  }

  clearPlayerProfiles(): void {
    this.raw().exec('DELETE FROM player_profiles');
  }

  // --- Groups ---

  saveGroups(data: Array<{
    id: string; name: string; memberIds: string; leaderId?: string;
    purpose: string; cohesion: number; createdAt: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_groups (id, name, member_ids, leader_id, purpose, cohesion, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const g of data) {
      stmt.run(g.id, g.name, g.memberIds, g.leaderId ?? null, g.purpose, g.cohesion, g.createdAt);
    }
  }

  loadAllGroups(): Array<{
    id: string; name: string; memberIds: string; leaderId?: string;
    purpose: string; cohesion: number; createdAt: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_groups').all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      memberIds: r.member_ids,
      leaderId: r.leader_id ?? undefined,
      purpose: r.purpose,
      cohesion: r.cohesion,
      createdAt: r.created_at,
    }));
  }

  clearGroups(): void {
    this.raw().exec('DELETE FROM character_groups');
  }

  // --- Player Sessions ---

  savePlayerSessions(data: Array<{
    playerId: string; joinedAt: number; lastActiveAt: number;
    characterInteractions: string;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO player_sessions (player_id, joined_at, last_active_at, character_interactions)
      VALUES (?, ?, ?, ?)
    `);
    for (const s of data) {
      stmt.run(s.playerId, s.joinedAt, s.lastActiveAt, s.characterInteractions);
    }
  }

  loadAllPlayerSessions(): Array<{
    playerId: string; joinedAt: number; lastActiveAt: number;
    characterInteractions: string;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM player_sessions').all() as any[];
    return rows.map(r => ({
      playerId: r.player_id,
      joinedAt: r.joined_at,
      lastActiveAt: r.last_active_at,
      characterInteractions: r.character_interactions,
    }));
  }

  clearPlayerSessions(): void {
    this.raw().exec('DELETE FROM player_sessions');
  }

  // --- Recent Actions ---

  saveRecentActions(data: Array<{ characterId: string; actions: string }>): void {
    const raw = this.raw();
    const now = Date.now();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO recent_actions (character_id, actions, updated_at)
      VALUES (?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.characterId, r.actions, now);
    }
  }

  loadAllRecentActions(): Array<{ characterId: string; actions: string }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM recent_actions').all() as any[];
    return rows.map(r => ({
      characterId: r.character_id,
      actions: r.actions,
    }));
  }

  clearRecentActions(): void {
    this.raw().exec('DELETE FROM recent_actions');
  }

  // --- Perceptions ---

  savePerceptions(data: Array<{
    characterId: string; location: string; nearbyCharacters: string; recentPerceptions: string;
  }>): void {
    const raw = this.raw();
    const now = Date.now();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_perceptions (character_id, location, nearby_characters, recent_perceptions, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.characterId, r.location, r.nearbyCharacters, r.recentPerceptions, now);
    }
  }

  loadAllPerceptions(): Array<{
    characterId: string; location: string; nearbyCharacters: string; recentPerceptions: string;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_perceptions').all() as any[];
    return rows.map(r => ({
      characterId: r.character_id,
      location: r.location,
      nearbyCharacters: r.nearby_characters,
      recentPerceptions: r.recent_perceptions,
    }));
  }

  clearPerceptions(): void {
    this.raw().exec('DELETE FROM character_perceptions');
  }

  // --- Needs ---

  saveNeeds(data: Array<{ characterId: string; needs: string }>): void {
    const raw = this.raw();
    const now = Date.now();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_needs (character_id, needs, updated_at)
      VALUES (?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.characterId, r.needs, now);
    }
  }

  loadAllNeeds(): Array<{ characterId: string; needs: string }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_needs').all() as any[];
    return rows.map(r => ({
      characterId: r.character_id,
      needs: r.needs,
    }));
  }

  clearNeeds(): void {
    this.raw().exec('DELETE FROM character_needs');
  }

  // --- Routines ---

  saveRoutines(data: Array<{
    id: string; characterId: string; name: string; activities: string;
    conditions?: string; isDefault: boolean; createdAt: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_routines (id, character_id, name, activities, conditions, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.id, r.characterId, r.name, r.activities, r.conditions ?? null, r.isDefault ? 1 : 0, r.createdAt);
    }
  }

  loadAllRoutines(): Array<{
    id: string; characterId: string; name: string; activities: string;
    conditions?: string; isDefault: boolean; createdAt: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_routines').all() as any[];
    return rows.map(r => ({
      id: r.id,
      characterId: r.character_id,
      name: r.name,
      activities: r.activities,
      conditions: r.conditions ?? undefined,
      isDefault: r.is_default === 1,
      createdAt: r.created_at,
    }));
  }

  clearRoutines(): void {
    this.raw().exec('DELETE FROM character_routines');
  }

  // --- Death Records ---

  saveDeathRecords(data: Array<{
    characterId: string; characterName: string; cause: string;
    timestamp: number; replacedBy?: string;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT INTO death_records (character_id, character_name, cause, timestamp, replaced_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.characterId, r.characterName, r.cause, r.timestamp, r.replacedBy ?? null);
    }
  }

  loadAllDeathRecords(): Array<{
    characterId: string; characterName: string; cause: string;
    timestamp: number; replacedBy?: string;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM death_records ORDER BY timestamp DESC').all() as any[];
    return rows.map(r => ({
      characterId: r.character_id,
      characterName: r.character_name,
      cause: r.cause,
      timestamp: r.timestamp,
      replacedBy: r.replaced_by ?? undefined,
    }));
  }

  clearDeathRecords(): void {
    this.raw().exec('DELETE FROM death_records');
  }

  // --- Gossip Items ---

  saveGossipItems(data: Array<{
    id: string; content: string; source: string; subject: string;
    originCharacterId: string; importance: number; credibility: number;
    spreadCount: number; tags: string; createdAt: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO gossip_items (id, content, source, subject, origin_character_id, importance, credibility, spread_count, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.id, r.content, r.source, r.subject, r.originCharacterId, r.importance, r.credibility, r.spreadCount, r.tags, r.createdAt);
    }
  }

  loadAllGossipItems(): Array<{
    id: string; content: string; source: string; subject: string;
    originCharacterId: string; importance: number; credibility: number;
    spreadCount: number; tags: string; createdAt: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM gossip_items').all() as any[];
    return rows.map(r => ({
      id: r.id,
      content: r.content,
      source: r.source,
      subject: r.subject,
      originCharacterId: r.origin_character_id,
      importance: r.importance,
      credibility: r.credibility,
      spreadCount: r.spread_count,
      tags: r.tags,
      createdAt: r.created_at,
    }));
  }

  clearGossipItems(): void {
    this.raw().exec('DELETE FROM gossip_items');
  }

  // --- Character Gossip ---

  saveCharacterGossip(data: Array<{ characterId: string; knownGossip: string }>): void {
    const raw = this.raw();
    const now = Date.now();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_gossip (character_id, known_gossip, updated_at)
      VALUES (?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.characterId, r.knownGossip, now);
    }
  }

  loadAllCharacterGossip(): Array<{ characterId: string; knownGossip: string }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_gossip').all() as any[];
    return rows.map(r => ({
      characterId: r.character_id,
      knownGossip: r.known_gossip,
    }));
  }

  clearCharacterGossip(): void {
    this.raw().exec('DELETE FROM character_gossip');
  }

  // --- Reputation ---

  saveReputation(data: Array<{ characterId: string; scores: string }>): void {
    const raw = this.raw();
    const now = Date.now();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO character_reputation (character_id, scores, updated_at)
      VALUES (?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.characterId, r.scores, now);
    }
  }

  loadAllReputation(): Array<{ characterId: string; scores: string }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM character_reputation').all() as any[];
    return rows.map(r => ({
      characterId: r.character_id,
      scores: r.scores,
    }));
  }

  clearReputation(): void {
    this.raw().exec('DELETE FROM character_reputation');
  }

  // --- Reputation Events ---

  saveReputationEvents(data: Array<{
    id: string; characterId: string; dimension: string; delta: number;
    reason: string; witnessIds: string; timestamp: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO reputation_events (id, character_id, dimension, delta, reason, witness_ids, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.id, r.characterId, r.dimension, r.delta, r.reason, r.witnessIds, r.timestamp);
    }
  }

  loadAllReputationEvents(): Array<{
    id: string; characterId: string; dimension: string; delta: number;
    reason: string; witnessIds: string; timestamp: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM reputation_events ORDER BY timestamp DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      characterId: r.character_id,
      dimension: r.dimension,
      delta: r.delta,
      reason: r.reason,
      witnessIds: r.witness_ids,
      timestamp: r.timestamp,
    }));
  }

  clearReputationEvents(): void {
    this.raw().exec('DELETE FROM reputation_events');
  }

  // --- Hierarchy Definitions ---

  saveHierarchyDefinitions(data: Array<{
    factionId: string; factionName: string; ranks: string;
    metadata: string; createdAt: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO hierarchy_definitions (faction_id, faction_name, ranks, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.factionId, r.factionName, r.ranks, r.metadata, r.createdAt);
    }
  }

  loadAllHierarchyDefinitions(): Array<{
    factionId: string; factionName: string; ranks: string;
    metadata: string; createdAt: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM hierarchy_definitions').all() as any[];
    return rows.map(r => ({
      factionId: r.faction_id,
      factionName: r.faction_name,
      ranks: r.ranks,
      metadata: r.metadata,
      createdAt: r.created_at,
    }));
  }

  clearHierarchyDefinitions(): void {
    this.raw().exec('DELETE FROM hierarchy_definitions');
  }

  // --- Hierarchy Memberships ---

  saveHierarchyMemberships(data: Array<{
    characterId: string; factionId: string; rankLevel: number; assignedAt: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO hierarchy_memberships (character_id, faction_id, rank_level, assigned_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.characterId, r.factionId, r.rankLevel, r.assignedAt);
    }
  }

  loadAllHierarchyMemberships(): Array<{
    characterId: string; factionId: string; rankLevel: number; assignedAt: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM hierarchy_memberships').all() as any[];
    return rows.map(r => ({
      characterId: r.character_id,
      factionId: r.faction_id,
      rankLevel: r.rank_level,
      assignedAt: r.assigned_at,
    }));
  }

  clearHierarchyMemberships(): void {
    this.raw().exec('DELETE FROM hierarchy_memberships');
  }

  // --- Hierarchy Orders ---

  saveHierarchyOrders(data: Array<{
    id: string; fromCharacterId: string; toCharacterId: string;
    factionId: string; instruction: string; scope: string;
    active: boolean; createdAt: number; expiresAt?: number;
  }>): void {
    const raw = this.raw();
    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO hierarchy_orders (id, from_character_id, to_character_id, faction_id, instruction, scope, active, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of data) {
      stmt.run(r.id, r.fromCharacterId, r.toCharacterId, r.factionId, r.instruction, r.scope, r.active ? 1 : 0, r.createdAt, r.expiresAt ?? null);
    }
  }

  loadAllHierarchyOrders(): Array<{
    id: string; fromCharacterId: string; toCharacterId: string;
    factionId: string; instruction: string; scope: string;
    active: boolean; createdAt: number; expiresAt?: number;
  }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT * FROM hierarchy_orders').all() as any[];
    return rows.map(r => ({
      id: r.id,
      fromCharacterId: r.from_character_id,
      toCharacterId: r.to_character_id,
      factionId: r.faction_id,
      instruction: r.instruction,
      scope: r.scope,
      active: r.active === 1,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? undefined,
    }));
  }

  clearHierarchyOrders(): void {
    this.raw().exec('DELETE FROM hierarchy_orders');
  }

  // --- Snapshots ---

  createSnapshot(id: string, name: string, description: string = '', metadata: Record<string, unknown> = {}): void {
    const raw = this.raw();
    raw.prepare(`
      INSERT INTO snapshots (id, name, description, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, description, JSON.stringify(metadata), Date.now());
  }

  getSnapshot(id: string): { id: string; name: string; description: string; metadata: Record<string, unknown>; createdAt: number } | null {
    const raw = this.raw();
    const row = raw.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
    };
  }

  listSnapshots(): Array<{ id: string; name: string; description: string; createdAt: number }> {
    const raw = this.raw();
    const rows = raw.prepare('SELECT id, name, description, created_at FROM snapshots ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
    }));
  }

  deleteSnapshot(id: string): void {
    this.raw().prepare('DELETE FROM snapshots WHERE id = ?').run(id);
  }
}
