import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// --- Characters ---

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  archetype: text('archetype').notNull(),
  identity: text('identity').notNull(),       // JSON: CharacterIdentity
  activityTier: text('activity_tier').notNull().default('dormant'),
  closeness: real('closeness').notNull().default(0),
  highWaterMark: real('high_water_mark').notNull().default(0),
  metadata: text('metadata').notNull().default('{}'), // JSON
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// --- Episodic Memories ---

export const episodicMemories = sqliteTable('episodic_memories', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  playerId: text('player_id').notNull().default('default'),
  type: text('type').notNull(),               // observation | interaction | reflection | dialogue
  content: text('content').notNull(),
  summary: text('summary').notNull(),
  importance: real('importance').notNull(),
  currentImportance: real('current_importance').notNull(),
  isDeep: integer('is_deep', { mode: 'boolean' }).notNull().default(false),
  isPermanent: integer('is_permanent', { mode: 'boolean' }).notNull().default(false),
  tags: text('tags').notNull().default('[]'), // JSON array
  eventType: text('event_type'),
  decayRate: real('decay_rate').notNull().default(1.0),
  createdAt: integer('created_at').notNull(),
  lastAccessedAt: integer('last_accessed_at').notNull(),
}, (table) => [
  index('idx_episodic_char_player').on(table.characterId, table.playerId),
  index('idx_episodic_importance').on(table.currentImportance),
  index('idx_episodic_event_type').on(table.eventType),
  index('idx_episodic_tags').on(table.tags),
]);

// --- Character Summaries ---

export const characterSummaries = sqliteTable('character_summaries', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  playerId: text('player_id').notNull().default('default'),
  summary: text('summary').notNull(),
  relationshipNotes: text('relationship_notes').notNull().default(''),
  keyFacts: text('key_facts').notNull().default('[]'), // JSON array
  version: integer('version').notNull().default(1),
  generatedAt: integer('generated_at').notNull(),
}, (table) => [
  index('idx_summary_char_player').on(table.characterId, table.playerId),
]);

// --- Working Memory ---

export const workingMemory = sqliteTable('working_memory', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  playerId: text('player_id').notNull().default('default'),
  role: text('role').notNull(),               // user | assistant | system
  content: text('content').notNull(),
  turnIndex: integer('turn_index').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_working_char_player').on(table.characterId, table.playerId),
  index('idx_working_turn').on(table.turnIndex),
]);

// --- Proximity Scores ---

export const proximityScores = sqliteTable('proximity_scores', {
  characterId: text('character_id').notNull(),
  playerId: text('player_id').notNull().default('default'),
  closeness: real('closeness').notNull().default(0),
  highWaterMark: real('high_water_mark').notNull().default(0),
  activityTier: text('activity_tier').notNull().default('dormant'),
  lastInteractionAt: integer('last_interaction_at').notNull(),
  totalInteractions: integer('total_interactions').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_proximity_pk').on(table.characterId, table.playerId),
  index('idx_proximity_tier').on(table.activityTier),
]);

// --- Chat Messages ---

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  playerId: text('player_id').notNull().default('default'),
  role: text('role').notNull(),               // player | character
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_chat_char_player').on(table.characterId, table.playerId),
  index('idx_chat_created').on(table.createdAt),
]);

// --- Delegation Orders ---

export const delegationOrders = sqliteTable('delegation_orders', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  playerId: text('player_id').notNull().default('default'),
  instruction: text('instruction').notNull(),
  scope: text('scope').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at'),
}, (table) => [
  index('idx_delegation_char').on(table.characterId, table.playerId),
]);

// --- Decision Log ---

export const decisionLog = sqliteTable('decision_log', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  playerId: text('player_id').notNull().default('default'),
  triggerType: text('trigger_type').notNull(),
  triggerEvent: text('trigger_event'),
  contextTokens: integer('context_tokens').notNull(),
  responseTokens: integer('response_tokens').notNull(),
  inferenceTier: text('inference_tier').notNull(),
  action: text('action').notNull(),           // JSON
  durationMs: integer('duration_ms').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_decision_char').on(table.characterId),
  index('idx_decision_created').on(table.createdAt),
]);

// --- Memory Embeddings (optional) ---

export const memoryEmbeddings = sqliteTable('memory_embeddings', {
  memoryId: text('memory_id').primaryKey(),
  embedding: text('embedding').notNull(),     // JSON float array
  model: text('model').notNull(),
  createdAt: integer('created_at').notNull(),
});

// --- Character Emotions (Expansion State Persistence) ---

export const characterEmotions = sqliteTable('character_emotions', {
  characterId: text('character_id').primaryKey(),
  activeEmotions: text('active_emotions').notNull().default('[]'), // JSON: EmotionState[]
  mood: text('mood').notNull().default('trust'),
  moodIntensity: real('mood_intensity').notNull().default(0.1),
  updatedAt: integer('updated_at').notNull(),
});

// --- Character Relationships (formalized) ---

export const characterRelationships = sqliteTable('character_relationships', {
  fromId: text('from_id').notNull(),
  toId: text('to_id').notNull(),
  type: text('type').notNull().default('neutral'),
  strength: real('strength').notNull().default(50),
  trust: real('trust').notNull().default(50),
  notes: text('notes').notNull().default(''),
  lastInteractionAt: integer('last_interaction_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_relationships_pk').on(table.fromId, table.toId),
]);

// --- Character Goals ---

export const characterGoals = sqliteTable('character_goals', {
  id: text('id').primaryKey(),
  characterId: text('character_id').notNull(),
  description: text('description').notNull(),
  priority: integer('priority').notNull().default(5),
  status: text('status').notNull().default('pending'),
  steps: text('steps').notNull().default('[]'), // JSON: GoalStep[]
  parentGoalId: text('parent_goal_id'),
  deadline: integer('deadline'),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
}, (table) => [
  index('idx_goals_char').on(table.characterId),
  index('idx_goals_status').on(table.status),
]);

// --- World Facts ---

export const worldFacts = sqliteTable('world_facts', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON
  category: text('category').notNull(),
  source: text('source').notNull(),
  confidence: real('confidence').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_facts_category').on(table.category),
]);

// --- Player Profiles ---

export const playerProfiles = sqliteTable('player_profiles', {
  playerId: text('player_id').primaryKey(),
  preferences: text('preferences').notNull().default('{}'), // JSON
  interactionPatterns: text('interaction_patterns').notNull().default('[]'), // JSON
  totalInteractions: integer('total_interactions').notNull().default(0),
  averageSessionLength: real('average_session_length').notNull().default(0),
  lastSeenAt: integer('last_seen_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// --- Character Groups ---

export const characterGroups = sqliteTable('character_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  memberIds: text('member_ids').notNull().default('[]'), // JSON: string[]
  leaderId: text('leader_id'),
  purpose: text('purpose').notNull(),
  cohesion: real('cohesion').notNull().default(0.7),
  createdAt: integer('created_at').notNull(),
});

// --- Player Sessions ---

export const playerSessions = sqliteTable('player_sessions', {
  playerId: text('player_id').primaryKey(),
  joinedAt: integer('joined_at').notNull(),
  lastActiveAt: integer('last_active_at').notNull(),
  characterInteractions: text('character_interactions').notNull().default('{}'), // JSON: Record<string, number>
});

// --- Recent Actions ---

export const recentActions = sqliteTable('recent_actions', {
  characterId: text('character_id').primaryKey(),
  actions: text('actions').notNull().default('[]'), // JSON: string[]
  updatedAt: integer('updated_at').notNull(),
});

// --- Snapshots ---

export const snapshots = sqliteTable('snapshots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  metadata: text('metadata').notNull().default('{}'), // JSON
  createdAt: integer('created_at').notNull(),
});
