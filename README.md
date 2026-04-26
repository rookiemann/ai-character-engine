# AI Character Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/Tests-415%20passing-brightgreen.svg)](tests/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

**Drop-in AI NPCs for any game.** The AI Character Engine turns LLM-powered agents into believable characters that make autonomous decisions via tool-calling, build fading memories across three tiers, and develop dynamic closeness to the player. Plug in any game — from tavern sims to space stations — through a single `GamePlugin` interface.

## One-Click Setup

### Windows
```
git clone https://github.com/aivrar/ai-character-engine.git
cd ai-character-engine
setup.bat
```

### Linux / Mac
```
git clone https://github.com/aivrar/ai-character-engine.git
cd ai-character-engine
chmod +x setup.sh && ./setup.sh
```

> **Game developer?** Start with [QUICKSTART.md](QUICKSTART.md) — add AI NPCs to your game in 15 minutes.

## Features

35 subsystems organized into six categories:

### Core
| Subsystem | Description |
|-----------|-------------|
| **Engine** | Top-level orchestrator that wires all subsystems together |
| **AgentRunner** | Stateless LLM calls: context in, decision out |
| **MemoryManager** | 3-tier memory: working ring buffer, episodic with fading, LLM-compressed summaries |
| **InferenceService** | Provider abstraction with batch concurrency |
| **TickScheduler** | Fast tick (active agents) + slow tick (background/dormant + maintenance) |
| **ProximityManager** | Closeness 0-100, drives activity tiers and capability unlocks |

### Social
| Subsystem | Description |
|-----------|-------------|
| **ChatService** | Direct chat with characters (closeness 40+) |
| **DelegationManager** | Delegate authority to characters (closeness 60+) |
| **ConversationManager** | Multi-agent conversations with turn-taking |
| **GossipManager** | Information propagation via talk_to, credibility decay per hop |
| **ReputationManager** | Collective knowledge (-100 to +100), witness-based scoring |
| **MoodContagionManager** | Ephemeral emotion spreading at locations |
| **HierarchyManager** | Factions, ranks, chain-of-command orders, auto-succession |

### Agent Intelligence
| Subsystem | Description |
|-----------|-------------|
| **EmotionManager** | Emotion tracking with mood state |
| **GoalPlanner** | Step-based goal tracking and pursuit |
| **PlayerModeler** | Learns player preferences over time |
| **NeedsManager** | 5 needs (rest, social, sustenance, safety, purpose) that drive initiative |
| **RoutineManager** | Phase-based daily activities tied to game time |
| **InitiativeChecker** | Event-driven decision triggers |
| **PerceptionManager** | Location tracking, spatial event filtering, nearby awareness |

### Memory
| Subsystem | Description |
|-----------|-------------|
| **3-Tier Memory** | Working (recent) -> Episodic (importance-scored, fading) -> Summary (compressed) |
| **SemanticRetriever** | Embedding-based memory search when SQL retrieval returns sparse results |
| **MemoryConsolidator** | Clusters similar memories (tag-based + optional semantic) |
| **EmbeddingService** | Optional embedding provider for semantic features |

### Infrastructure
| Subsystem | Description |
|-----------|-------------|
| **ToolRegistry** | Game registers tools, engine routes to LLM function calling |
| **ToolValidator** | Type coercion, range clamping, size limits |
| **FailoverChain** | Circuit breaker with exponential cooldown (5s-120s) |
| **PriorityQueue** | Priority-based agent scheduling |
| **Middleware** | Pipeline for request/response processing |
| **StatePersistence** | Save/load state, snapshots, import/export |
| **HttpServer** | 30 REST endpoints, native Node.js (no frameworks) |
| **MetricsCollector** | Sliding-window latency percentiles, tool/action distribution |
| **PromptExperiment** | A/B testing with weighted variant assignment |
| **MultiPlayer** | Per-player closeness and character relationships |
| **ErrorRecovery** | Tool hallucination recovery, context-size retry, graceful shutdown |
| **StreamingChat** | SSE-based streaming for chat responses |

### Lifecycle
| Subsystem | Description |
|-----------|-------------|
| **LifecycleManager** | Character death, cleanup, and auto-respawn |

## Quick Start

### 1. Install

Use the setup script (recommended) or install manually:

```bash
git clone https://github.com/aivrar/ai-character-engine.git
cd ai-character-engine
npm install
npm run build
cp engine.config.example.json engine.config.json
```

### 2. Configure a Provider

Edit `engine.config.json` to set your inference provider. The default is **vLLM** (highest throughput):

```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server --model Salesforce/xLAM-2-1b-fc-r --port 8100
```

Or for the easiest start, use **Ollama**:

```bash
# Install Ollama from https://ollama.com
ollama pull qwen2.5:7b
```

Then change `engine.config.json` inference type to `"ollama"` (see Minimal Config Examples below).

### 3. Run the Starter Demo

```bash
npm run demo:starter
```

This starts "Quiet Village" — 2 characters (farmer + blacksmith) making autonomous decisions. The code in `examples/my-first-plugin/` is heavily commented as a learning template.

### 4. Run the Full Sample

```bash
npm run demo:sample
```

"Tavern Tales" — a medieval tavern with 4 characters (barkeep, merchant, bard, guard) who chat with the player and react to events.

### 5. Try the HTTP API

```bash
npm run demo:api
```

Then in another terminal:

```bash
# Health check
curl http://localhost:3000/api/health

# List characters
curl http://localhost:3000/api/characters

# Chat with a character
curl -X POST http://localhost:3000/api/chat/char-0 \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hello!"}'

# Inject a game event
curl -X POST http://localhost:3000/api/events \
  -H 'Content-Type: application/json' \
  -d '{"event":{"type":"combat","source":"bandits","data":{"description":"Bandits attack!"},"importance":8,"timestamp":0}}'
```

## Provider Setup

The engine supports 6 LLM providers. Local providers are strongly recommended — the engine makes hundreds of LLM calls per minute.

| Provider | Type | Best For | Setup |
|----------|------|----------|-------|
| **vLLM** | Local | **Recommended** — highest throughput (11+ dec/s) | Python + CUDA GPU |
| **Ollama** | Local | Easy start — zero config, 2 minutes | `ollama pull qwen2.5:7b` |
| **LM Studio** | Local | GUI-friendly exploration | Load model in GUI |
| **OpenRouter** | Cloud | Multi-model access (no GPU needed) | API key |
| **OpenAI** | Cloud | GPT models | API key |
| **Anthropic** | Cloud | Claude models | API key |

**Cost warning:** Cloud providers (OpenRouter, OpenAI, Anthropic) will incur significant costs because the engine makes continuous LLM calls for every active character.

See [docs/provider-setup.md](docs/provider-setup.md) for detailed setup instructions for each provider.

### Minimal Config Examples

**vLLM (recommended — highest throughput):**
```json
{
  "inference": {
    "type": "vllm",
    "baseUrl": "http://127.0.0.1:8100/v1",
    "models": { "heavy": "default", "mid": "default", "light": "default" },
    "maxConcurrency": 64,
    "timeoutMs": 60000
  }
}
```

**Ollama (easy start):**
```json
{
  "inference": {
    "type": "ollama",
    "models": { "heavy": "qwen2.5:7b", "mid": "qwen2.5:7b", "light": "qwen2.5:1.5b" }
  }
}
```

## Architecture

```
                           +-----------------------+
                           |       GamePlugin      |
                           | (your game implements)|
                           +-----------+-----------+
                                       |
                                       v
+----------------------------------------------------------------------+
|                              ENGINE                                   |
|                                                                      |
|  +--------------+    +-----------------+    +-------------------+    |
|  | TickScheduler|--->| AgentRunner     |--->| InferenceService  |    |
|  | fast + slow  |    | context->decision|   | 6 providers       |    |
|  +--------------+    +-----------------+    +-------------------+    |
|         |                    |                                        |
|         v                    v                                        |
|  +--------------+    +-----------------+    +-------------------+    |
|  | Proximity    |    | ContextAssembler|    | FailoverChain     |    |
|  | Manager      |    | + PromptBuilder |    | circuit breaker   |    |
|  +--------------+    +-----------------+    +-------------------+    |
|         |                    |                                        |
|         v                    v                                        |
|  +--------------+    +-----------------+    +-------------------+    |
|  | Activity     |    | MemoryManager   |    | ToolRegistry      |    |
|  | Tiers        |    | 3-tier + fading |    | + ToolValidator   |    |
|  +--------------+    +-----------------+    +-------------------+    |
|                              |                                        |
|  Social:                     v              Intelligence:            |
|  ChatService          MemoryConsolidator    EmotionManager           |
|  DelegationMgr        SemanticRetriever     GoalPlanner              |
|  ConversationMgr      EmbeddingService      PlayerModeler            |
|  GossipMgr                                  NeedsManager             |
|  ReputationMgr        Infra:                RoutineManager           |
|  MoodContagionMgr     HttpServer (30 API)   InitiativeChecker        |
|  HierarchyMgr         MetricsCollector      PerceptionManager        |
|                        StatePersistence                              |
|  Lifecycle:            PromptExperiment                              |
|  LifecycleManager      Middleware                                    |
+----------------------------------------------------------------------+
```

**Data flow for each decision:**

```
GameEvent
  -> PerceptionManager (spatial filtering)
  -> ContextAssembler (gather memories, state, proprioception)
  -> PromptBuilder (budget-aware prompt construction)
  -> AgentRunner (LLM call via InferenceService)
  -> ToolValidator (validate + coerce tool arguments)
  -> ToolRegistry (execute game-registered tool)
  -> MemoryManager (store result as episodic memory)
```

**Tick lifecycle:**
- **Fast tick** (default 2s): Processes active-tier agents. Each gets a full decision cycle with up to 6 tools.
- **Slow tick** (default 30s): Processes background and dormant agents with reduced token budgets. Also runs maintenance: memory decay, consolidation, summary regeneration.

## GamePlugin Interface

Games integrate by implementing the `GamePlugin` interface:

```typescript
import { Engine, loadConfigFile } from 'ai-character-engine';
import type { GamePlugin } from 'ai-character-engine';

const myPlugin: GamePlugin = {
  id: 'my-game',
  name: 'My Game',

  // Required: Define character archetypes
  getArchetypes() {
    return [{
      id: 'warrior',
      name: 'Warrior',
      description: 'A brave fighter',
      defaultIdentity: {
        personality: 'Bold and loyal',
        backstory: 'Trained since youth',
        goals: ['Protect the village'],
        traits: ['brave', 'strong'],
      },
    }];
  },

  // Required: Define tools characters can use
  getTools() {
    return [{
      definition: {
        name: 'attack',
        description: 'Attack a target',
        parameters: [
          { name: 'target', type: 'string', description: 'Who to attack', required: true },
        ],
      },
      executor: (args) => ({
        success: true,
        result: `Attacked ${args.target}!`,
      }),
    }];
  },

  // Required: Current game state snapshot
  getGameState() {
    return {
      worldTime: Date.now(),
      location: 'Village',
      nearbyEntities: ['Player', 'Merchant'],
      recentEvents: ['Morning has broken'],
    };
  },

  // Required: Character self-knowledge
  getProprioception(characterId) {
    return {
      currentAction: 'idle',
      location: 'village_square',
      inventory: ['sword', 'shield'],
      status: ['healthy'],
      energy: 0.8,
    };
  },

  // Optional: Initial characters to spawn
  getInitialCharacters() {
    return [{
      id: 'guard-1',
      name: 'Theron',
      archetype: 'warrior',
      identity: {
        personality: 'Stern but fair',
        backstory: 'Captain of the guard',
        goals: ['Keep the peace'],
        traits: ['loyal', 'vigilant'],
      },
      initialCloseness: 30,
    }];
  },

  // Optional: World rules for system prompts
  getWorldRules() {
    return 'Medieval fantasy village. No modern technology. Gold is currency.';
  },
};

// Start the engine
const config = loadConfigFile(); // or inline config
const engine = new Engine(config);
await engine.loadPlugin(myPlugin);
engine.start();
```

See [docs/game-plugin-guide.md](docs/game-plugin-guide.md) for the complete interface reference with all 25+ methods.

## Configuration Reference

The full configuration is in `engine.config.example.json`. Key sections:

```jsonc
{
  // Database
  "database": {
    "path": "./data/engine.db"    // SQLite file path, or ":memory:" for in-memory
  },

  // Inference provider
  "inference": {
    "type": "ollama",             // ollama | vllm | lmstudio | openrouter | openai | anthropic
    "baseUrl": "...",             // Provider URL (auto-set for ollama)
    "apiKey": "...",              // For cloud providers
    "models": {
      "heavy": "qwen2.5:7b",     // Complex decisions
      "mid": "qwen2.5:7b",       // Standard decisions
      "light": "qwen2.5:1.5b"    // Simple decisions
    },
    "maxConcurrency": 10,         // Parallel requests (64 for vLLM)
    "timeoutMs": 30000,           // Request timeout
    "maxRetries": 2               // Retry count
  },

  // Optional: Embeddings for semantic memory
  "embedding": {
    "type": "ollama",
    "models": { "heavy": "nomic-embed-text", "mid": "nomic-embed-text", "light": "nomic-embed-text" },
    "maxConcurrency": 4,
    "timeoutMs": 10000
  },

  // Proximity / closeness
  "proximity": {
    "decayRatePerTick": 0.1,      // Closeness decay per slow tick
    "interactionBoost": 4,         // Boost on tool interaction
    "chatBoost": 2,                // Boost on chat message
    "promotionThreshold": 60,      // Active tier threshold
    "backgroundThreshold": 20,     // Background tier threshold
    "dormantThreshold": 5,         // Dormant tier threshold
    "chatMinCloseness": 40,        // Min closeness to chat
    "delegateMinCloseness": 60     // Min closeness to delegate
  },

  // Tick scheduling
  "tick": {
    "fastTickMs": 2000,            // Active agent processing interval
    "slowTickMs": 30000,           // Background + maintenance interval
    "batchSize": 10                // Agents per batch
  },

  // Memory
  "memory": {
    "workingMemorySize": 5,            // Ring buffer size
    "episodicRetrievalCount": 5,       // Memories to retrieve per decision
    "importanceThreshold": 3,          // Min importance to store
    "decayInterval": 10,               // Ticks between decay passes
    "pruneThreshold": 0.5,             // Remove memories below this score
    "summaryRegenerateInterval": 50    // Decisions between summary regen
  },

  // Logging
  "logging": {
    "level": "info",               // trace | debug | info | warn | error
    "pretty": true                 // Pretty-print logs (disable in production)
  }
}
```

## Examples

| Example | Command | Description |
|---------|---------|-------------|
| **My First Plugin** | `npm run demo:starter` | 2 characters in a village — heavily commented learning template |
| **Tavern Tales** | `npm run demo:sample` | 4 characters in a medieval tavern, demonstrates chat, events, and tool use |
| **Game Simulations** | `npm run demo:sim` | 6 game genres (pirate, space, farm, detective, survival, academy) with 32 characters each against vLLM |
| **Diagnostics** | `npm run demo:diagnose` | Raw LLM output analysis — categorizes tool call failures |
| **Rich Context** | `npm run demo:rich` | Compares bare vs rich game state impact on decision quality |
| **API Server** | `npm run demo:api` | HTTP API server on port 3000, integrate from any language |

All examples support `loadConfigFile()` — drop an `engine.config.json` in the project root and every example picks it up. Without one, each falls back to sensible inline defaults.

## Performance

Benchmarked with the xLAM-2-1B model (Salesforce) on an RTX 3090:

| Metric | Value |
|--------|-------|
| Peak throughput | **11.91 decisions/sec** |
| Token throughput | **16,350 tokens/sec** |
| Characters | 32 simultaneous |
| Concurrency | 64 parallel requests |
| Latency (p50) | 4.6s |
| Errors | 0 |
| Tool types used | 5/6 |
| Tool balance | No tool above 23% |

10 models tested across 7 configurations. Full results in `examples/stress-test/results/`.

**Model recommendations:**
- **xLAM-2-1B** (Salesforce) — Best balance of speed and tool-calling accuracy
- **Qwen2.5-1.5B** — Fastest raw throughput, but 82% dialogue (low tool usage)
- **7B+ models** — Better reasoning, but 3-5x higher latency

## Troubleshooting

### Provider not running

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED 127.0.0.1:8100` | Start vLLM: `python -m vllm.entrypoints.openai.api_server --model <path> --port 8100` |
| `ECONNREFUSED 127.0.0.1:11434` | Start Ollama: `ollama serve` (or it starts automatically on first `ollama pull`) |
| `ECONNREFUSED 127.0.0.1:1234` | Open LM Studio, load a model, and click "Start Server" |
| Health check says `inference: false` | Your provider URL or port doesn't match `engine.config.json` |

### better-sqlite3 build failure (Windows)

The `better-sqlite3` package requires native compilation. If `npm install` fails:

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Select the **"Desktop development with C++"** workload
3. Run `npm install` again

### Model not found

| Provider | Fix |
|----------|-----|
| vLLM | The model path in `--model` must exist. Use HuggingFace ID (`Salesforce/xLAM-2-1b-fc-r`) or local path. |
| Ollama | Run `ollama pull <model-name>` first. List available: `ollama list` |
| LM Studio | Load the model in the GUI before starting the server |

### Timeout errors

- **Increase `timeoutMs`** in `engine.config.json` (default 60000 for vLLM, 30000 for Ollama)
- **Use a smaller model** — 1-2B parameter models are 3-5x faster than 7B+
- **Reduce `batchSize`** in tick config if your GPU is overloaded

### Characters only talk, never use tools

- **Model choice matters** — `xLAM-2-1b-fc-r` (Salesforce) has the best tool-calling accuracy for small models
- **Tool descriptions** should be clear and specific — vague descriptions confuse small models
- **2-6 tools** is the sweet spot — too many tools overwhelm small models

### Common config mistakes

| Mistake | Fix |
|---------|-----|
| Wrong `type` for provider | Must be exactly: `vllm`, `ollama`, `lmstudio`, `openrouter`, `openai`, or `anthropic` |
| Missing `baseUrl` for vLLM | Add `"baseUrl": "http://127.0.0.1:8100/v1"` (Ollama auto-detects) |
| `models` set to `"default"` with Ollama | Ollama needs real model names: `"qwen2.5:7b"`. Only vLLM/LM Studio use `"default"` |
| `maxConcurrency` too high for Ollama | Ollama processes sequentially — keep at 10 or lower |

### Windows-specific issues

- **vLLM on Windows**: No official pip wheel — use the [pre-built Windows environment](https://github.com/aivrar/vllm-windows-build) or see [docs/vllm-windows.md](docs/vllm-windows.md)
- **vLLM requires `--enforce-eager`** — CUDA graphs (Triton) don't work on Windows
- **GPU memory**: max `gpu-memory-utilization` is ~0.92 (display driver reserves ~80MB)
- **Don't use `CUDA_DEVICE_ORDER=PCI_BUS_ID`** — it can flip GPU indices on some systems

## Documentation

- [Quick Start Guide](QUICKSTART.md) — Add AI NPCs to your game in 15 minutes
- [Architecture](docs/architecture.md) — System design, subsystem graph, tick lifecycle, data flow
- [Game Plugin Guide](docs/game-plugin-guide.md) — Complete plugin interface reference and tutorial
- [Provider Setup](docs/provider-setup.md) — Detailed setup for all 6 providers + embeddings
- [Memory System](docs/memory-system.md) — 3-tier memory, fading, retrieval, consolidation
- [Proximity System](docs/proximity-system.md) — Closeness, activity tiers, capability unlocks
- [vLLM on Windows](docs/vllm-windows.md) — Building and running vLLM on Windows with CUDA
- [API Reference](docs/api-reference.md) — All 30 HTTP API endpoints with schemas and examples
- [Contributing](CONTRIBUTING.md) — Development setup, code style, PR guidelines

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, code style, and how to add new subsystems or providers.

```bash
# Development workflow
npm install
npm run build       # Compile TypeScript
npm test            # Run 415 unit tests
npm run test:e2e    # Run E2E tests (requires vLLM)
npm run lint        # Type-check without emitting
```

## License

[MIT](LICENSE)
