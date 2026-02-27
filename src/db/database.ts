import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { getLogger } from '../core/logger';
import * as fs from 'fs';
import * as path from 'path';

export type DB = BetterSQLite3Database<typeof schema>;

let db: DB | null = null;
let rawDb: Database.Database | null = null;

export function initDatabase(dbPath: string): DB {
  const log = getLogger('database');

  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  rawDb = new Database(dbPath);

  // Performance pragmas
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('synchronous = NORMAL');
  rawDb.pragma('foreign_keys = ON');
  rawDb.pragma('busy_timeout = 5000');

  db = drizzle(rawDb, { schema });

  // Create tables if they don't exist
  createTables(rawDb);
  migrateSchema(rawDb);

  log.info({ path: dbPath }, 'Database initialized');
  return db;
}

export function getDatabase(): DB {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function getRawDatabase(): Database.Database {
  if (!rawDb) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return rawDb;
}

export function closeDatabase(): void {
  if (rawDb) {
    rawDb.close();
    rawDb = null;
    db = null;
  }
}

function createTables(raw: Database.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      archetype TEXT NOT NULL,
      identity TEXT NOT NULL,
      activity_tier TEXT NOT NULL DEFAULT 'dormant',
      closeness REAL NOT NULL DEFAULT 0,
      high_water_mark REAL NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS episodic_memories (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      player_id TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      importance REAL NOT NULL,
      current_importance REAL NOT NULL,
      is_deep INTEGER NOT NULL DEFAULT 0,
      is_permanent INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      event_type TEXT,
      decay_rate REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_episodic_char_player ON episodic_memories(character_id, player_id);
    CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memories(current_importance);
    CREATE INDEX IF NOT EXISTS idx_episodic_event_type ON episodic_memories(event_type);

    CREATE TABLE IF NOT EXISTS character_summaries (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      player_id TEXT NOT NULL DEFAULT 'default',
      summary TEXT NOT NULL,
      relationship_notes TEXT NOT NULL DEFAULT '',
      key_facts TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      generated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_summary_char_player ON character_summaries(character_id, player_id);

    CREATE TABLE IF NOT EXISTS working_memory (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      player_id TEXT NOT NULL DEFAULT 'default',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_working_char_player ON working_memory(character_id, player_id);
    CREATE INDEX IF NOT EXISTS idx_working_turn ON working_memory(turn_index);

    CREATE TABLE IF NOT EXISTS proximity_scores (
      character_id TEXT NOT NULL,
      player_id TEXT NOT NULL DEFAULT 'default',
      closeness REAL NOT NULL DEFAULT 0,
      high_water_mark REAL NOT NULL DEFAULT 0,
      activity_tier TEXT NOT NULL DEFAULT 'dormant',
      last_interaction_at INTEGER NOT NULL,
      total_interactions INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (character_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_proximity_tier ON proximity_scores(activity_tier);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      player_id TEXT NOT NULL DEFAULT 'default',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_char_player ON chat_messages(character_id, player_id);
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);

    CREATE TABLE IF NOT EXISTS delegation_orders (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      player_id TEXT NOT NULL DEFAULT 'default',
      instruction TEXT NOT NULL,
      scope TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_delegation_char ON delegation_orders(character_id, player_id);

    CREATE TABLE IF NOT EXISTS decision_log (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      player_id TEXT NOT NULL DEFAULT 'default',
      trigger_type TEXT NOT NULL,
      trigger_event TEXT,
      context_tokens INTEGER NOT NULL,
      response_tokens INTEGER NOT NULL,
      inference_tier TEXT NOT NULL,
      action TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_decision_char ON decision_log(character_id);
    CREATE INDEX IF NOT EXISTS idx_decision_created ON decision_log(created_at);

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_emotions (
      character_id TEXT PRIMARY KEY,
      active_emotions TEXT NOT NULL DEFAULT '[]',
      mood TEXT NOT NULL DEFAULT 'trust',
      mood_intensity REAL NOT NULL DEFAULT 0.1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_relationships (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'neutral',
      strength REAL NOT NULL DEFAULT 50,
      trust REAL NOT NULL DEFAULT 50,
      notes TEXT NOT NULL DEFAULT '',
      last_interaction_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (from_id, to_id)
    );

    CREATE INDEX IF NOT EXISTS idx_relationships_pk ON character_relationships(from_id, to_id);

    CREATE TABLE IF NOT EXISTS character_goals (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      description TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'pending',
      steps TEXT NOT NULL DEFAULT '[]',
      parent_goal_id TEXT,
      deadline INTEGER,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_goals_char ON character_goals(character_id);
    CREATE INDEX IF NOT EXISTS idx_goals_status ON character_goals(status);

    CREATE TABLE IF NOT EXISTS world_facts (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_facts_category ON world_facts(category);

    CREATE TABLE IF NOT EXISTS player_profiles (
      player_id TEXT PRIMARY KEY,
      preferences TEXT NOT NULL DEFAULT '{}',
      interaction_patterns TEXT NOT NULL DEFAULT '[]',
      total_interactions INTEGER NOT NULL DEFAULT 0,
      average_session_length REAL NOT NULL DEFAULT 0,
      last_seen_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      member_ids TEXT NOT NULL DEFAULT '[]',
      leader_id TEXT,
      purpose TEXT NOT NULL,
      cohesion REAL NOT NULL DEFAULT 0.7,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_sessions (
      player_id TEXT PRIMARY KEY,
      joined_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      character_interactions TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS recent_actions (
      character_id TEXT PRIMARY KEY,
      actions TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_perceptions (
      character_id TEXT PRIMARY KEY,
      location TEXT NOT NULL DEFAULT '',
      nearby_characters TEXT NOT NULL DEFAULT '[]',
      recent_perceptions TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_needs (
      character_id TEXT PRIMARY KEY,
      needs TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_routines (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      activities TEXT NOT NULL DEFAULT '[]',
      conditions TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_routines_char ON character_routines(character_id);

    CREATE TABLE IF NOT EXISTS death_records (
      character_id TEXT NOT NULL,
      character_name TEXT NOT NULL,
      cause TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      replaced_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_death_timestamp ON death_records(timestamp);

    CREATE TABLE IF NOT EXISTS gossip_items (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      subject TEXT NOT NULL,
      origin_character_id TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 5,
      credibility REAL NOT NULL DEFAULT 1.0,
      spread_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gossip_created ON gossip_items(created_at);

    CREATE TABLE IF NOT EXISTS character_gossip (
      character_id TEXT PRIMARY KEY,
      known_gossip TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_reputation (
      character_id TEXT PRIMARY KEY,
      scores TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reputation_events (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      dimension TEXT NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      witness_ids TEXT NOT NULL DEFAULT '[]',
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rep_events_char ON reputation_events(character_id);

    CREATE TABLE IF NOT EXISTS hierarchy_definitions (
      faction_id TEXT PRIMARY KEY,
      faction_name TEXT NOT NULL,
      ranks TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hierarchy_memberships (
      character_id TEXT NOT NULL,
      faction_id TEXT NOT NULL,
      rank_level INTEGER NOT NULL DEFAULT 99,
      assigned_at INTEGER NOT NULL,
      PRIMARY KEY (character_id, faction_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hierarchy_faction ON hierarchy_memberships(faction_id, rank_level);

    CREATE TABLE IF NOT EXISTS hierarchy_orders (
      id TEXT PRIMARY KEY,
      from_character_id TEXT NOT NULL,
      to_character_id TEXT NOT NULL,
      faction_id TEXT NOT NULL,
      instruction TEXT NOT NULL,
      scope TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_hierarchy_orders_to ON hierarchy_orders(to_character_id, active);
  `);
}

/**
 * Apply schema migrations for existing databases.
 */
function migrateSchema(raw: Database.Database): void {
  // Add is_permanent column if missing (trauma memories, added in expansion 33)
  const cols = raw.pragma('table_info(episodic_memories)') as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'is_permanent')) {
    raw.exec('ALTER TABLE episodic_memories ADD COLUMN is_permanent INTEGER NOT NULL DEFAULT 0');
  }
}
