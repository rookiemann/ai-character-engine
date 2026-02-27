# AI Character Engine -- Architecture

## Overview

The AI Character Engine is a game-agnostic framework for creating autonomous AI characters (NPCs) that make their own decisions using LLM-powered tool calling, build fading memories, and develop dynamic relationships with the player. It is designed to be plugged into any game via the `GamePlugin` interface.

**Tech Stack:**
- Node.js v24 + TypeScript (CommonJS module format)
- SQLite via better-sqlite3 + Drizzle ORM for persistence
- Pino for structured logging
- Zod for configuration validation
- eventemitter3 for typed event system
- Abstracted LLM inference: vLLM (primary/recommended), LM Studio, OpenRouter, OpenAI, Anthropic, Ollama

**Scale:** 35 subsystems, 134 unit tests + 6 E2E tests passing, TypeScript compiles cleanly.

---

## High-Level Architecture

The **Engine** class (`src/core/Engine.ts`) is the top-level orchestrator. It instantiates, wires, and exposes all subsystems. Games interact with the engine through:

1. **GamePlugin** -- the game implements this interface to provide tools, game state, character definitions, and hooks
2. **Engine public API** -- convenience methods for chat, delegation, events, closeness, introspection, etc.
3. **Event system** -- subscribe to typed events for reactive integration
4. **HTTP API** -- 25+ REST endpoints via the built-in HttpServer

```
                         +---------------------------+
                         |       Game / Client       |
                         +---------------------------+
                                    |
                         +----------v----------+
                         |     GamePlugin       |
                         |  (tools, state,      |
                         |   hooks, characters) |
                         +----------+----------+
                                    |
          +-------------------------v-------------------------+
          |                      ENGINE                       |
          |  (top-level orchestrator, wires all subsystems)   |
          +---------------------------------------------------+
          |                                                   |
          |   +-------------+    +------------------+         |
          |   | TickScheduler|<-->| AgentScheduler   |         |
          |   | (fast/slow) |    | BatchProcessor   |         |
          |   +------+------+    | ActivityTierMgr  |         |
          |          |           +------------------+         |
          |          v                                        |
          |   +-------------+    +------------------+         |
          |   | AgentRunner  |<-->| ContextAssembler |         |
          |   | (LLM calls)  |    | PromptBuilder    |         |
          |   +------+------+    +------------------+         |
          |          |                                        |
          |   +------v------+    +------------------+         |
          |   | ToolExecutor |<-->| ToolRegistry     |         |
          |   | (game tools) |    | ToolValidator    |         |
          |   +-------------+    +------------------+         |
          |                                                   |
          |   +----------------+  +------------------+        |
          |   | MemoryManager  |  | InferenceService |        |
          |   | (3-tier memory)|  | (provider abstraction)|   |
          |   +----------------+  +------------------+        |
          |                                                   |
          |   +----------------+  +------------------+        |
          |   |ProximityManager|  | ChatService      |        |
          |   | (closeness)    |  | StreamingChat    |        |
          |   +----------------+  +------------------+        |
          |                                                   |
          |   +----------------+  +------------------+        |
          |   | EmotionManager |  | GoalPlanner      |        |
          |   | NeedsManager   |  | RoutineManager   |        |
          |   | PerceptionMgr  |  | InitiativeCheck  |        |
          |   +----------------+  +------------------+        |
          |                                                   |
          |   +----------------+  +------------------+        |
          |   | GossipManager  |  | ReputationManager|        |
          |   | HierarchyMgr   |  | MoodContagionMgr|        |
          |   | ConversationMgr|  | RelationshipMgr  |        |
          |   +----------------+  +------------------+        |
          |                                                   |
          |   +----------------+  +------------------+        |
          |   | LifecycleManager| | StatePersistence |        |
          |   | (death/respawn)|  | FailoverChain    |        |
          |   +----------------+  | HttpServer       |        |
          |                       | MetricsCollector |        |
          |                       +------------------+        |
          +---------------------------------------------------+
```

---

## Subsystem Catalog (35 Total)

### Core (6)

| Subsystem | File | Purpose |
|-----------|------|---------|
| **Engine** | `src/core/Engine.ts` | Top-level orchestrator. Wires all subsystems, exposes public API, manages lifecycle. |
| **AgentRunner** | `src/agent/AgentRunner.ts` | Stateless LLM decision cycle: context in, tool call / dialogue / idle out. Handles fuzzy JSON parsing, tool reordering by recency, middleware hooks. |
| **MemoryManager** | `src/memory/MemoryManager.ts` | 3-tier memory: working ring buffer, episodic with fading, LLM-compressed summary. |
| **InferenceService** | `src/inference/InferenceService.ts` | Provider-agnostic LLM abstraction. Manages concurrency, batching, tiered model selection (heavy/mid/light). |
| **TickScheduler** | `src/scheduler/TickScheduler.ts` | Dual-loop scheduler: fast tick (active agents) + slow tick (background/dormant + maintenance tasks). |
| **ProximityManager** | `src/proximity/ProximityManager.ts` | Closeness tracking (0-100), tier promotion/demotion, decay, interaction boosts. |

### Social (7)

| Subsystem | File | Purpose |
|-----------|------|---------|
| **ChatService** | `src/chat/ChatService.ts` | Direct player-to-character chat. Requires closeness >= 40. Builds context from memory + character identity. |
| **DelegationManager** | `src/proximity/DelegationManager.ts` | Player delegates instructions to characters (closeness >= 60). Orders have scope and optional expiry. |
| **ConversationManager** | `src/agent/ConversationManager.ts` | Multi-agent NPC-to-NPC conversations with turn-taking, topic, and max turns. |
| **GossipManager** | `src/agent/GossipManager.ts` | Information propagation via `talk_to`. Credibility decays x0.8 per hop. TTL expiration, per-character cap 20, global cap 200. |
| **ReputationManager** | `src/agent/ReputationManager.ts` | Collective reputation scores (-100 to +100) across dimensions. Witness-based scoring, gossip integration, decay toward 0. |
| **MoodContagionManager** | `src/agent/MoodContagionManager.ts` | Ephemeral emotion spreading at shared locations. Emotion-specific contagion rates, relationship modifiers, crowd factor. |
| **HierarchyManager** | `src/agent/HierarchyManager.ts` | Factions with ranked memberships. Chain-of-command orders (superior to subordinate), promotion/demotion, auto-succession on death. |

### Agent Intelligence (7)

| Subsystem | File | Purpose |
|-----------|------|---------|
| **EmotionManager** | `src/agent/EmotionManager.ts` | 8 emotion types (joy, sadness, anger, fear, surprise, disgust, trust, anticipation). Intensity 0-1, per-tick decay. |
| **GoalPlanner** | `src/agent/GoalPlanner.ts` | Hierarchical goals with priority 1-10, steps, status tracking (pending/active/completed/failed/abandoned). |
| **PlayerModeler** | `src/agent/PlayerModeler.ts` | Tracks player preferences, interaction patterns, session data. Characters adapt behavior to player style. |
| **NeedsManager** | `src/agent/NeedsManager.ts` | 5 default needs (rest, social, sustenance, safety, purpose). Grow per fast tick, fulfilled by tools/events. Drives initiative. |
| **RoutineManager** | `src/agent/RoutineManager.ts` | Phase-based daily activities. Game provides `timePhase` via `getGameState().custom.timePhase`. |
| **InitiativeChecker** | `src/agent/InitiativeChecker.ts` | Determines when characters should self-initiate actions based on emotions, goals, needs, and hierarchy orders. |
| **PerceptionManager** | `src/agent/PerceptionManager.ts` | Location tracking, spatial event filtering, nearby character awareness. |

### Memory (4)

| Subsystem | File | Purpose |
|-----------|------|---------|
| **3-Tier Memory** | `src/memory/` | Working (ring buffer) -> Episodic (importance-scored, fading) -> Summary (LLM-compressed). See [memory-system.md](./memory-system.md). |
| **SemanticRetriever** | `src/memory/SemanticRetriever.ts` | Embedding-based memory retrieval. Falls back when SQL-first episodic retrieval returns fewer than 2 results. |
| **MemoryConsolidator** | `src/memory/MemoryConsolidator.ts` | Clusters similar memories (tag-based or semantic when EmbeddingService is available). Auto-runs every 10 slow ticks. |
| **EmbeddingService** | `src/inference/EmbeddingService.ts` | Optional embedding provider. Powers SemanticRetriever and semantic clustering. Configured via `config.embedding`. |

### Infrastructure (12)

| Subsystem | File | Purpose |
|-----------|------|---------|
| **ToolRegistry** | `src/tools/ToolRegistry.ts` | Game registers tools (name, parameters, executor). Engine routes to LLM function calling. |
| **ToolValidator** | `src/tools/ToolValidator.ts` | Full type coercion, range clamping, string/array size limits for tool arguments. |
| **FailoverChain** | `src/inference/FailoverChain.ts` | Circuit breaker pattern (closed/open/half_open). Exponential cooldown (5s to 120s cap). Multiple provider fallback. |
| **PriorityQueue** | `src/scheduler/PriorityQueue.ts` | Priority-based event queue for the scheduler. Higher importance events processed first. |
| **Middleware** | `src/core/Middleware.ts` | Pipeline for `beforeDecision` and `afterDecision` hooks. Plugin and user-defined middleware. |
| **StatePersistence** | `src/db/StatePersistence.ts` | Saves/loads all Persistable subsystem state to/from SQLite. Snapshot support. |
| **HttpServer** | `src/api/HttpServer.ts` | 25+ REST endpoints. 1MB body limit, security headers, metrics/experiment endpoints. Native Node.js HTTP. |
| **MetricsCollector** | `src/core/MetricsCollector.ts` | Sliding-window (5min) latency percentiles, tool/action distribution, hint rates. |
| **PromptExperiment** | `src/agent/PromptExperiment.ts` | A/B testing for prompts. Weighted variant assignment, outcome tracking, comparative reports. |
| **MultiPlayerManager** | `src/scheduler/MultiPlayerManager.ts` | Multi-player support. Per-player proximity and memory scoping. |
| **ErrorRecovery** | Various | Tool hallucination recovery, context-size retry, graceful shutdown. |
| **StreamingChat** | `src/chat/StreamingChatService.ts` | SSE-based streaming chat responses. AsyncGenerator yield of content chunks. |

### Lifecycle (1)

| Subsystem | File | Purpose |
|-----------|------|---------|
| **LifecycleManager** | `src/agent/LifecycleManager.ts` | Character death processing, cleanup of all subsystem data, auto-respawn with configurable delay. Plugin `spawnReplacement()` or random archetype fallback. |

---

## Tick Lifecycle

The TickScheduler runs two concurrent loops:

### Fast Tick (default: every 2000ms)

1. Selects **active-tier** agents (closeness >= 60), up to `maxAgentsPerFastTick` (default 15)
2. For each agent, builds decision context and sends to AgentRunner in batches of `batchSize` (default 10)
3. Decays all emotion intensities
4. Grows all character needs
5. Emits `tick:fast` event

### Slow Tick (default: every 30000ms)

1. Selects **background and dormant** agents for processing
2. Runs maintenance tasks:
   - Proximity decay for all characters
   - Memory importance decay and pruning
   - Relationship strength decay
   - Goal pruning (abandoned/expired)
   - Gossip expiration (TTL)
   - Reputation decay toward 0
   - Mood contagion processing
   - Hierarchy order expiration
   - Routine phase updates (from game state)
   - Perception location updates
   - Lifecycle respawn processing
3. Runs auto-consolidation (every 10 slow ticks, up to 5 characters)
4. Runs initiative checking for active characters
5. Persists all state to database
6. Emits `tick:slow` event

---

## Activity Tier System

Characters are assigned to one of three tiers based on their closeness to the player:

| Tier | Closeness Range | Context Tokens | Response Tokens | Max Tools | Processing |
|------|----------------|---------------|-----------------|-----------|------------|
| **Active** | >= 60 | 800 | 150 | 6 (all available) | Every fast tick |
| **Background** | >= 20 | 400 | 100 | 2 (round-robin) | Every slow tick |
| **Dormant** | >= 5 | 250 | 80 | 1 (round-robin) | Every slow tick |

### Tool Rotation

Background and dormant tiers do not receive all tools simultaneously. Instead, a **round-robin rotation** ensures every tier cycles through the full tool set over time. Each tick presents a different subset of tools, so that even dormant characters eventually try all available actions.

### Capability Unlocks

- **Chat**: Requires closeness >= 40 (`chatMinCloseness`)
- **Delegation**: Requires closeness >= 60 (`delegateMinCloseness`)
- **Tool access**: Some tools can declare a `requiredTier` or `minCloseness` in their definition

---

## Data Flow

The decision pipeline for a single agent decision:

```
GameEvent (from game or injectEvent)
    |
    v
PerceptionManager
    |  - Filters events by spatial proximity
    |  - Identifies nearby characters
    |
    v
ContextAssembler
    |  - Gathers: character identity, working memory, episodic memories,
    |    summary, emotions, goals, relationships, needs, routine,
    |    gossip, reputation, hierarchy, world state, perception
    |  - Applies token budget (tier-dependent)
    |  - Sorts memories by importance
    |  - Adds variety hints if tool dominance detected
    |
    v
PromptBuilder
    |  - Structured XML sections for system prompt
    |  - Incremental hint fitting within budget
    |  - Tier-aware max hints
    |  - FNV hash caching (128 entries)
    |
    v
Middleware (beforeDecision)
    |  - Plugin hooks
    |  - Custom middleware
    |
    v
AgentRunner
    |  - Sends InferenceRequest to InferenceService
    |  - Parses LLM response (tool call JSON or dialogue)
    |  - fuzzyParseToolCall() recovers malformed JSON
    |  - reorderByRecency() puts unused tools first
    |
    v
ToolExecutor
    |  - Validates arguments via ToolValidator
    |  - Executes game-registered tool handler
    |  - Returns ToolResult (success, result, sideEffects)
    |
    v
Middleware (afterDecision)
    |
    v
Post-processing
    - Memory creation (episodic record)
    - Proximity boost (interaction)
    - Player modeling update
    - Gossip propagation (if talk_to)
    - Reputation changes (if witnessed)
    - Decision log entry
    - Metrics recording
    - Emit 'agent:decision' event
```

---

## Event System

The engine uses a strongly-typed event emitter (`eventemitter3` wrapped in `TypedEventEmitter`). All events and their signatures are defined in `src/core/events.ts`.

### Available Events

**Agent Events:**
- `agent:decision` -- Fired after each agent decision. Payload: `AgentDecisionResult`
- `agent:error` -- Fired on agent decision error. Payload: `(characterId, Error)`

**Memory Events:**
- `memory:created` -- New episodic memory stored. Payload: `MemoryRecord`
- `memory:pruned` -- Memories pruned for a character. Payload: `(characterId, count)`
- `memory:summaryUpdated` -- Character summary regenerated. Payload: `characterId`

**Proximity Events:**
- `proximity:changed` -- Closeness score updated. Payload: `ProximityScore`
- `proximity:tierChanged` -- Character moved between tiers. Payload: `(characterId, oldTier, newTier)`

**Tick Events:**
- `tick:fast` -- Fast tick completed. Payload: `timestamp`
- `tick:slow` -- Slow tick completed. Payload: `timestamp`

**Game Events:**
- `game:event` -- External game event injected. Payload: `GameEvent`

**Chat Events:**
- `chat:message` -- Chat message sent or received. Payload: `ChatMessage`

**Character Lifecycle Events:**
- `character:registered` -- New character registered. Payload: `CharacterState`
- `character:removed` -- Character removed. Payload: `characterId`
- `character:died` -- Character died. Payload: `(characterId, cause)`
- `character:spawned` -- Character spawned (possibly replacing a dead one). Payload: `(CharacterState, replacedId?)`
- `phase:changed` -- Routine time phase changed. Payload: `(oldPhase, newPhase)`

**Social Events:**
- `gossip:spread` -- Gossip spread between characters. Payload: `(fromId, toId, gossipId)`
- `reputation:changed` -- Reputation score changed. Payload: `(characterId, dimension, delta)`

**Hierarchy Events:**
- `hierarchy:rankChanged` -- Character rank changed in a faction. Payload: `(characterId, factionId, oldRank, newRank)`
- `hierarchy:orderIssued` -- Order issued through chain of command. Payload: `(fromId, toId, factionId)`
- `hierarchy:succession` -- Auto-succession triggered. Payload: `(factionId, characterId, newRank)`

**Engine Lifecycle Events:**
- `engine:started` -- Engine started. No payload.
- `engine:stopped` -- Engine stopped. No payload.
- `engine:error` -- Engine-level error. Payload: `Error`

### Subscribing to Events

```typescript
const engine = new Engine(config);

engine.events.on('agent:decision', (result) => {
  console.log(`${result.characterId} chose:`, result.action);
});

engine.events.on('proximity:tierChanged', (charId, oldTier, newTier) => {
  console.log(`${charId} moved from ${oldTier} to ${newTier}`);
});

engine.events.on('character:died', (charId, cause) => {
  console.log(`${charId} died: ${cause}`);
});
```

---

## Configuration

The engine is configured via a JSON object validated by Zod. See `engine.config.example.json` for a full example.

```typescript
interface EngineConfig {
  database: { path: string };
  inference: ProviderConfig;       // Primary LLM provider
  embedding?: ProviderConfig;      // Optional embedding provider
  proximity: Partial<ProximityConfig>;
  tick: Partial<TickConfig>;
  memory: {
    workingMemorySize: number;          // Default: 5
    episodicRetrievalCount: number;     // Default: 5
    importanceThreshold: number;        // Default: 3
    decayInterval: number;              // Default: 10
    pruneThreshold: number;             // Default: 0.5
    summaryRegenerateInterval: number;  // Default: 50
  };
  logging: { level: string; pretty: boolean };
}
```

### Provider Types

The `ProviderConfig.type` field supports:
- `vllm` -- vLLM (recommended for production, highest throughput)
- `lmstudio` -- LM Studio (local, easy setup)
- `openrouter` -- OpenRouter (cloud, many models)
- `openai` -- OpenAI API
- `anthropic` -- Anthropic API
- `ollama` -- Ollama (local)

Each provider supports tiered model selection (`heavy`, `mid`, `light`) and optional round-robin model pools.

---

## Directory Structure

```
src/
  core/           Engine, events, types, config, errors, logger, Middleware, MetricsCollector
  agent/          AgentRunner, ContextAssembler, PromptBuilder, ToolExecutor,
                  ConversationManager, EmotionManager, GoalPlanner, RelationshipManager,
                  PlayerModeler, GroupManager, WorldStateManager, InitiativeChecker,
                  PerceptionManager, NeedsManager, RoutineManager, LifecycleManager,
                  GossipManager, ReputationManager, MoodContagionManager, HierarchyManager,
                  PromptExperiment, AgentRegistry
  memory/         MemoryManager, WorkingMemory, EpisodicMemory, CharacterSummary,
                  ImportanceScorer, MemoryRetriever, SemanticRetriever, MemoryConsolidator
  inference/      InferenceService, EmbeddingService, TokenBudget, FailoverChain,
                  providers/ (BaseProvider, VLLMProvider, LMStudioProvider, OpenRouterProvider,
                             OpenAIProvider, AnthropicProvider, OllamaProvider)
  proximity/      ProximityManager, DelegationManager, ProximityRules
  scheduler/      TickScheduler, AgentScheduler, BatchProcessor, ActivityTierManager,
                  PriorityQueue, MultiPlayerManager
  chat/           ChatService, ChatHistory, StreamingChatService
  tools/          ToolRegistry, ToolValidator, ToolDefinition
  db/             database, schema, StatePersistence,
                  repositories/ (CharacterRepository, MemoryRepository,
                                ProximityRepository, ChatRepository,
                                StateRepository, DecisionRepository)
  plugin/         GamePlugin, PluginLoader, PluginHooks
  api/            HttpServer
  index.ts        Public exports
```
