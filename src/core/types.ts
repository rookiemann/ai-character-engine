// ============================================================
// AI Character Engine - Core Type Definitions
// ============================================================

// --- Activity & Inference Tiers ---

export type ActivityTier = 'active' | 'background' | 'dormant';
export type InferenceTier = 'heavy' | 'mid' | 'light';

// --- Character Definition ---

export interface CharacterIdentity {
  personality: string;
  backstory: string;
  goals: string[];
  traits: string[];
  speechStyle?: string;
  quirks?: string[];
}

export interface CharacterDefinition {
  id: string;
  name: string;
  archetype: string;
  identity: CharacterIdentity;
  initialCloseness?: number;
  metadata?: Record<string, unknown>;
}

export interface CharacterState {
  id: string;
  name: string;
  archetype: string;
  identity: CharacterIdentity;
  activityTier: ActivityTier;
  closeness: number;
  highWaterMark: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// --- Memory System ---

export interface MemoryRecord {
  id: string;
  characterId: string;
  playerId: string;
  type: 'observation' | 'interaction' | 'reflection' | 'dialogue';
  content: string;
  summary: string;
  importance: number;        // 1-10 base importance
  currentImportance: number; // Fades over time
  isDeep: boolean;           // Resists fading (importance >= 9)
  isPermanent: boolean;      // Never decays or prunes (importance >= 10, trauma)
  tags: string[];
  eventType?: string;
  decayRate: number;         // Multiplier for decay (default 1.0, deep = 0.1, permanent = 0)
  createdAt: number;
  lastAccessedAt: number;
}

export interface WorkingMemoryEntry {
  id: string;
  characterId: string;
  playerId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turnIndex: number;
  createdAt: number;
}

export interface CharacterSummaryRecord {
  id: string;
  characterId: string;
  playerId: string;
  summary: string;
  relationshipNotes: string;
  keyFacts: string[];
  version: number;
  generatedAt: number;
}

// --- Proximity / Closeness ---

export interface ProximityScore {
  characterId: string;
  playerId: string;
  closeness: number;
  highWaterMark: number;
  activityTier: ActivityTier;
  lastInteractionAt: number;
  totalInteractions: number;
  updatedAt: number;
}

export interface ProximityConfig {
  decayRatePerTick: number;      // Default: 0.1
  interactionBoost: number;      // Default: 3-5
  chatBoost: number;             // Default: 2
  promotionThreshold: number;    // Active tier: >= 60
  backgroundThreshold: number;   // Background tier: >= 20
  dormantThreshold: number;      // Dormant tier: < 20
  chatMinCloseness: number;      // Can chat if >= 40
  delegateMinCloseness: number;  // Can delegate if >= 60
  highWaterDecayMultiplier: number; // Established relationships fade slower
}

// --- Tool System ---

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  min?: number;       // Minimum value for numbers
  max?: number;       // Maximum value for numbers
  maxLength?: number; // Maximum string length
  maxItems?: number;  // Maximum array size
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  requiredTier?: ActivityTier;   // Minimum tier to use this tool
  minCloseness?: number;         // Minimum closeness to use
  category?: string;
  cooldownMs?: number;
}

export interface ToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  sideEffects?: GameEvent[];
}

// --- Agent Decision Cycle ---

export interface AgentDecisionRequest {
  characterId: string;
  playerId: string;
  triggerEvent?: GameEvent;
  gameState: GameState;
  proprioception: CharacterProprioception;
  availableTools: ToolDefinition[];
  energyLevel: number;  // 0-1, based on activity tier budget
}

export interface AgentDecisionResult {
  characterId: string;
  action: ToolCall | DialogueAction | IdleAction;
  reasoning?: string;
  tokensUsed: number;
  inferenceTier: InferenceTier;
  durationMs: number;
}

export interface DialogueAction {
  type: 'dialogue';
  target?: string;
  content: string;
}

export interface IdleAction {
  type: 'idle';
  thought?: string;
}

// --- Game Integration ---

export interface GameState {
  worldTime: number;
  location?: string;
  nearbyEntities?: string[];
  recentEvents?: string[];
  custom?: Record<string, unknown>;
}

export interface CharacterProprioception {
  currentAction?: string;
  location?: string;
  inventory?: string[];
  status?: string[];
  energy?: number;
  custom?: Record<string, unknown>;
}

export interface GameEvent {
  type: string;
  source?: string;
  target?: string;
  data?: Record<string, unknown>;
  importance?: number;
  timestamp: number;
}

// --- Inference ---

export interface InferenceRequest {
  messages: InferenceMessage[];
  tools?: ToolDefinition[];
  tier: InferenceTier;
  maxTokens?: number;
  temperature?: number;
  characterId?: string;
}

export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceResponse {
  content: string;
  toolCalls?: ToolCall[];
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  model: string;
  durationMs: number;
}

export interface ProviderConfig {
  type: 'lmstudio' | 'openrouter' | 'openai' | 'anthropic' | 'vllm' | 'ollama';
  baseUrl?: string;
  apiKey?: string;
  models: {
    heavy: string;
    mid: string;
    light: string;
  };
  /** Round-robin model pools per tier. If set, overrides the single model for that tier. */
  modelsPool?: {
    heavy?: string[];
    mid?: string[];
    light?: string[];
  };
  maxConcurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** GPU device index to pin this provider to. Informational for local providers (vllm, ollama, lmstudio). */
  gpuId?: number;
}

// --- Chat ---

export interface ChatMessage {
  id: string;
  characterId: string;
  playerId: string;
  role: 'player' | 'character';
  content: string;
  createdAt: number;
}

// --- Delegation ---

export interface DelegationOrder {
  id: string;
  characterId: string;
  playerId: string;
  instruction: string;
  scope: string;
  active: boolean;
  createdAt: number;
  expiresAt?: number;
}

// --- Scheduler ---

export interface TickConfig {
  fastTickMs: number;    // Default: 2000 (2s)
  slowTickMs: number;    // Default: 30000 (30s)
  maxAgentsPerFastTick: number;
  maxAgentsPerSlowTick: number;
  batchSize: number;     // Concurrent LLM calls per batch
}

// --- Engine Config ---

export interface EngineConfig {
  database: {
    path: string;
  };
  inference: ProviderConfig;
  embedding?: ProviderConfig;
  proximity: Partial<ProximityConfig>;
  tick: Partial<TickConfig>;
  memory: {
    workingMemorySize: number;     // Default: 5
    episodicRetrievalCount: number; // Default: 5
    importanceThreshold: number;    // Default: 3
    decayInterval: number;          // Ticks between decay passes
    pruneThreshold: number;         // Remove memories below this
    summaryRegenerateInterval: number; // Slow ticks between summary regen
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    pretty: boolean;
  };
}

// --- Decision Log ---

export interface DecisionLogEntry {
  id: string;
  characterId: string;
  playerId: string;
  triggerType: string;
  triggerEvent?: string;
  contextTokens: number;
  responseTokens: number;
  inferenceTier: InferenceTier;
  action: string;
  durationMs: number;
  createdAt: number;
}

// --- Expansion 4: Multi-Agent Conversations ---

export interface AgentConversation {
  id: string;
  participantIds: string[];
  topic: string;
  turns: ConversationTurn[];
  maxTurns: number;
  status: 'active' | 'completed';
  startedAt: number;
  completedAt?: number;
}

export interface ConversationTurn {
  characterId: string;
  content: string;
  action?: ToolCall | DialogueAction | IdleAction;
  timestamp: number;
}

// --- Expansion 5: Emotion System ---

export type EmotionType =
  | 'joy' | 'sadness' | 'anger' | 'fear'
  | 'surprise' | 'disgust' | 'trust' | 'anticipation';

export interface EmotionState {
  type: EmotionType;
  intensity: number;    // 0-1
  decayRate: number;    // Per tick decay
  source?: string;      // What caused it
  createdAt: number;
}

export interface CharacterEmotions {
  characterId: string;
  active: EmotionState[];
  mood: EmotionType;        // Dominant emotion
  moodIntensity: number;
}

// --- Expansion 6: Character-to-Character Relationships ---

export type RelationshipType =
  | 'friend' | 'rival' | 'mentor' | 'student'
  | 'ally' | 'enemy' | 'neutral' | 'romantic' | 'family';

export interface CharacterRelationship {
  fromId: string;
  toId: string;
  type: RelationshipType;
  strength: number;      // 0-100
  trust: number;         // 0-100
  notes: string;
  lastInteractionAt: number;
  updatedAt: number;
}

// --- Expansion 7: Goal Planning ---

export type GoalStatus = 'pending' | 'active' | 'completed' | 'failed' | 'abandoned';

export interface CharacterGoal {
  id: string;
  characterId: string;
  description: string;
  priority: number;       // 1-10
  status: GoalStatus;
  steps: GoalStep[];
  parentGoalId?: string;  // Sub-goal support
  deadline?: number;
  createdAt: number;
  completedAt?: number;
}

export interface GoalStep {
  description: string;
  completed: boolean;
  toolName?: string;      // Tool to use for this step
}

// --- Expansion 8: Persistent World State ---

export interface WorldFact {
  key: string;
  value: unknown;
  category: string;
  source: string;        // Who/what set this
  confidence: number;    // 0-1
  updatedAt: number;
}

// --- Expansion 9: Player Modeling ---

export interface PlayerProfile {
  playerId: string;
  preferences: Record<string, number>;    // e.g. { "combat": 0.8, "social": 0.6 }
  interactionPatterns: InteractionPattern[];
  totalInteractions: number;
  averageSessionLength: number;
  lastSeenAt: number;
  updatedAt: number;
}

export interface InteractionPattern {
  type: string;
  count: number;
  lastAt: number;
}

// --- Expansion 10: Group Behaviors ---

export interface CharacterGroup {
  id: string;
  name: string;
  memberIds: string[];
  leaderId?: string;
  purpose: string;
  cohesion: number;      // 0-1 group unity
  createdAt: number;
}

export interface GroupDecision {
  groupId: string;
  action: ToolCall | DialogueAction | IdleAction;
  votes: Record<string, string>;  // characterId → vote
  consensus: number;     // 0-1 agreement level
}

// --- Expansion 15: Memory Consolidation ---

export interface ConsolidationResult {
  mergedCount: number;
  newMemoryId: string;
  originalIds: string[];
}

// --- Expansion 29: Perception ---

export interface PerceptionEntry {
  type: 'character' | 'event';
  id: string;
  description: string;
  location: string;
  timestamp: number;
  importance?: number;
}

export interface CharacterPerception {
  characterId: string;
  location: string;
  nearbyCharacters: string[];
  recentPerceptions: PerceptionEntry[];
  updatedAt: number;
}

// --- Expansion 30: Needs ---

export type NeedType = 'rest' | 'social' | 'sustenance' | 'safety' | 'purpose' | string;

export interface CharacterNeed {
  type: NeedType;
  intensity: number;        // 0=satisfied, 1=critical
  growthRate: number;        // per-fast-tick increase
  decayOnFulfill: number;   // reduction on fulfillment
  lastFulfilledAt: number;
}

export interface CharacterNeeds {
  characterId: string;
  needs: CharacterNeed[];
}

export interface NeedTypeDefinition {
  type: NeedType;
  defaultGrowthRate: number;
  defaultDecayOnFulfill: number;
  description: string;
  fulfillmentTools?: string[];
  fulfillmentEvents?: string[];
}

// --- Expansion 31: Routines ---

export interface RoutineActivity {
  phase: string;          // game-defined ('morning', 'evening', etc.)
  activity: string;       // 'trading at marketplace'
  location?: string;
  priority: number;       // 1-10
}

export interface CharacterRoutine {
  id: string;
  characterId: string;
  name: string;
  activities: RoutineActivity[];
  conditions?: Record<string, unknown>;
  isDefault: boolean;
  createdAt: number;
}

// --- Expansion 32: Lifecycle ---

export interface LifecycleConfig {
  targetPopulation?: number;
  respawnDelayMs: number;
  enableAutoRespawn: boolean;
}

export interface CharacterDeathRecord {
  characterId: string;
  characterName: string;
  cause: string;
  timestamp: number;
  replacedBy?: string;
}

// --- Expansion 35: Gossip System ---

export interface GossipItem {
  id: string;
  content: string;           // "Grok was seen stealing from the market"
  source: string;            // originator's name (human-readable)
  subject: string;           // who/what the gossip is about (characterId or topic)
  originCharacterId: string; // characterId who created it
  importance: number;        // 1-10
  credibility: number;       // 0-1, degrades per hop (* 0.8)
  spreadCount: number;
  tags: string[];
  createdAt: number;
}

// --- Expansion 36: Reputation System ---

export type ReputationDimension = 'general' | string;

export interface ReputationScores {
  characterId: string;
  scores: Record<ReputationDimension, number>; // -100 to +100
}

export interface ReputationEvent {
  id: string;
  characterId: string;
  dimension: ReputationDimension;
  delta: number;
  reason: string;
  witnessIds: string[];
  timestamp: number;
}

// --- Expansion 38: Hierarchy System ---

export interface HierarchyRankDef {
  level: number;        // 0 = highest (CEO), higher = lower rank
  name: string;         // 'CEO', 'Manager', 'Employee'
  maxMembers?: number;  // optional cap (e.g., 1 CEO)
}

export interface HierarchyDefinition {
  factionId: string;
  factionName: string;
  ranks: HierarchyRankDef[];
  metadata?: Record<string, unknown>;
}

export interface HierarchyMembership {
  characterId: string;
  factionId: string;
  rankLevel: number;
  assignedAt: number;
}

export interface HierarchyOrder {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  factionId: string;
  instruction: string;
  scope: string;
  active: boolean;
  createdAt: number;
  expiresAt?: number;
}

// --- Persistable Interface ---

export interface Persistable {
  saveState(repo: any): void;
  loadState(repo: any): void;
}

// --- Tool Execution Context ---

export interface ToolExecutionContext {
  characterId: string;
  characterName: string;
  activityTier: ActivityTier;
  closeness: number;
  gameState?: GameState;
  proprioception?: CharacterProprioception;
}

// --- Character Introspection ---

export interface CharacterIntrospection {
  character: CharacterState;
  proximity: ProximityScore | null;
  emotions: CharacterEmotions | null;
  relationships: CharacterRelationship[];
  goals: CharacterGoal[];
  recentMemories: MemoryRecord[];
  summary: CharacterSummaryRecord | null;
  groups: CharacterGroup[];
  workingMemory: WorkingMemoryEntry[];
  routine: RoutineActivity | null;
  needs: CharacterNeeds | null;
  nearbyCharacters: string[];
  gossipKnown: GossipItem[];
  reputation: ReputationScores | null;
  hierarchy: HierarchyMembership[];
}

// --- Snapshot ---

export interface SnapshotInfo {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}
