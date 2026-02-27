// ============================================================
// AI Character Engine - Public API
// ============================================================

// Core Engine
export { Engine } from './core/Engine';

// Types
export type {
  // Character
  CharacterDefinition,
  CharacterIdentity,
  CharacterState,

  // Memory
  MemoryRecord,
  WorkingMemoryEntry,
  CharacterSummaryRecord,

  // Proximity
  ProximityScore,
  ProximityConfig,

  // Tools
  ToolDefinition,
  ToolParameter,
  ToolCall,
  ToolResult,
  ToolExecutionContext,

  // Agent
  AgentDecisionRequest,
  AgentDecisionResult,
  DialogueAction,
  IdleAction,

  // Game
  GameState,
  CharacterProprioception,
  GameEvent,

  // Inference
  InferenceRequest,
  InferenceResponse,
  InferenceMessage,
  ProviderConfig,

  // Chat
  ChatMessage,
  DelegationOrder,

  // Config
  EngineConfig,
  TickConfig,
  ActivityTier,
  InferenceTier,
  DecisionLogEntry,

  // Expansion types
  AgentConversation,
  ConversationTurn,
  EmotionType,
  EmotionState,
  CharacterEmotions,
  RelationshipType,
  CharacterRelationship,
  CharacterGoal,
  GoalStep,
  GoalStatus,
  WorldFact,
  PlayerProfile,
  InteractionPattern,
  CharacterGroup,
  GroupDecision,
  ConsolidationResult,

  // New types
  Persistable,
  CharacterIntrospection,
  SnapshotInfo,

  // Expansion 29-32 types
  PerceptionEntry,
  CharacterPerception,
  NeedType,
  CharacterNeed,
  CharacterNeeds,
  NeedTypeDefinition,
  RoutineActivity,
  CharacterRoutine,
  LifecycleConfig,
  CharacterDeathRecord,
  GossipItem,
  ReputationDimension,
  ReputationScores,
  ReputationEvent,
  HierarchyRankDef,
  HierarchyDefinition,
  HierarchyMembership,
  HierarchyOrder,
} from './core/types';

// Plugin interface
export type { GamePlugin, ArchetypeDefinition } from './plugin/GamePlugin';
export type { ToolExecutorFn } from './tools/ToolRegistry';

// Events
export type { EngineEvents } from './core/events';

// Errors
export {
  EngineError,
  ConfigError,
  ValidationError,
  InferenceError,
  TimeoutError,
  RateLimitError,
  ToolError,
  MemoryError,
  PluginError,
  ProximityError,
  AgentError,
} from './core/errors';

// Config helpers
export { validateConfig, loadConfigFile, DEFAULT_PROXIMITY, DEFAULT_TICK, DEFAULT_MEMORY } from './core/config';

// Metrics
export { MetricsCollector } from './core/MetricsCollector';
export type { MetricsSnapshot } from './core/MetricsCollector';

// Middleware
export { MiddlewarePipeline } from './core/Middleware';
export type { MiddlewareFn, MiddlewarePhase, MiddlewareContext } from './core/Middleware';

// State persistence
export { StatePersistence } from './db/StatePersistence';
export { StateRepository } from './db/repositories/StateRepository';
export { DecisionRepository } from './db/repositories/DecisionRepository';
export type { DecisionQueryFilters } from './db/repositories/DecisionRepository';

// HTTP API
export { HttpServer } from './api/HttpServer';

// Expansion subsystem classes (for advanced usage)
export { ConversationManager } from './agent/ConversationManager';
export { EmotionManager } from './agent/EmotionManager';
export { RelationshipManager } from './agent/RelationshipManager';
export { GoalPlanner } from './agent/GoalPlanner';
export { WorldStateManager } from './agent/WorldStateManager';
export { PlayerModeler } from './agent/PlayerModeler';
export { GroupManager } from './agent/GroupManager';
export { InitiativeChecker } from './agent/InitiativeChecker';
export type { InitiativeConfig } from './agent/InitiativeChecker';
export { PerceptionManager } from './agent/PerceptionManager';
export { NeedsManager } from './agent/NeedsManager';
export { RoutineManager } from './agent/RoutineManager';
export { LifecycleManager } from './agent/LifecycleManager';
export type { LifecycleSubsystems } from './agent/LifecycleManager';
export { GossipManager } from './agent/GossipManager';
export type { GossipConfig } from './agent/GossipManager';
export { ReputationManager } from './agent/ReputationManager';
export type { ReputationConfig } from './agent/ReputationManager';
export { HierarchyManager } from './agent/HierarchyManager';
export { MoodContagionManager } from './agent/MoodContagionManager';
export { PromptExperiment } from './agent/PromptExperiment';
export type { PromptVariant, PromptVariantConfig, ExperimentReport, ExperimentOutcome } from './agent/PromptExperiment';
export { SemanticRetriever } from './memory/SemanticRetriever';
export { MemoryConsolidator } from './memory/MemoryConsolidator';
export { FailoverChain } from './inference/FailoverChain';
export { VLLMProvider } from './inference/providers/VLLMProvider';
export { OllamaProvider } from './inference/providers/OllamaProvider';
export { StreamingChatService } from './chat/StreamingChatService';
export { PriorityQueue } from './scheduler/PriorityQueue';
export { MultiPlayerManager } from './scheduler/MultiPlayerManager';
