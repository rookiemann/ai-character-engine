# Add AI NPCs to Your Game in 15 Minutes

This guide walks you through creating AI characters that make autonomous decisions, build memories, and develop relationships with the player.

## What You'll Build

By the end of this guide, your game will have:

- **Characters that think** — Each character uses an LLM to decide what to do (pick up a sword, talk to someone, craft an item)
- **Fading 3-tier memory** — Characters remember important events but gradually forget old ones
- **Dynamic closeness** — Characters that interact with the player become more "known", unlocking chat and delegation
- **Tool-calling** — Characters act through tools YOU define, so every action is game-meaningful

## Step 1: Install

### One Command (Recommended)

**Windows:**
```
git clone https://github.com/aivrar/ai-character-engine.git
cd ai-character-engine
setup.bat
```

**Linux / Mac:**
```
git clone https://github.com/aivrar/ai-character-engine.git
cd ai-character-engine
chmod +x setup.sh && ./setup.sh
```

The setup script installs dependencies, builds the project, detects your LLM provider, and generates `engine.config.json`.

### Manual Install

```bash
git clone https://github.com/aivrar/ai-character-engine.git
cd ai-character-engine
npm install
npm run build
cp engine.config.example.json engine.config.json
# Edit engine.config.json to match your provider
```

## Step 2: Choose Your LLM Provider

Characters need an LLM to think. Pick one:

### Option A: vLLM (Recommended — 11+ decisions/sec)

Best performance. Requires a CUDA GPU.

```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model Salesforce/xLAM-2-1b-fc-r \
  --port 8100
```

Config (`engine.config.json`):
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

### Option B: Ollama (Easiest — 2 minutes)

Works on any machine. Lower throughput but zero hassle.

```bash
# Install: https://ollama.com
ollama pull qwen2.5:7b
```

Config:
```json
{
  "inference": {
    "type": "ollama",
    "models": { "heavy": "qwen2.5:7b", "mid": "qwen2.5:7b", "light": "qwen2.5:1.5b" }
  }
}
```

### Option C: Cloud (No GPU required — costs money)

Works immediately, but the engine makes hundreds of LLM calls per minute. Expect significant costs.

```json
{
  "inference": {
    "type": "openrouter",
    "apiKey": "sk-or-...",
    "models": { "heavy": "qwen/qwen-2.5-7b-instruct", "mid": "qwen/qwen-2.5-7b-instruct", "light": "qwen/qwen-2.5-1.5b-instruct" }
  }
}
```

## Step 3: Verify

```bash
npm run demo:starter
```

You should see characters making decisions every few seconds. If it prints "No inference provider detected", check that your LLM is running.

## Step 4: Create Your Plugin

A **plugin** is how your game connects to the engine. It answers four questions:

```
Your Game ──→ Plugin Methods ──→ Engine (ticks) ──→ LLM (decides)
     ↑                                                    |
     └──── Tool Executor (modifies game state) ←──────────┘
```

The engine calls your plugin every tick to get fresh state, sends it to the LLM, and the LLM picks a tool. Your tool executor runs the action and returns the result.

### The 4 Required Methods

| Method | Question It Answers | Example Return |
|--------|-------------------|----------------|
| `getArchetypes()` | What TYPES of characters exist? | `[{ id: 'guard', name: 'Guard', ... }]` |
| `getTools()` | What can characters DO? | `[{ definition: {...}, executor: (args) => {...} }]` |
| `getGameState()` | What can characters SEE? | `{ location: 'forest', nearbyEntities: [...] }` |
| `getProprioception(id)` | What does each character KNOW ABOUT THEMSELVES? | `{ inventory: ['sword'], energy: 0.8 }` |

Start from the template:

```bash
cp -r examples/my-first-plugin examples/my-game
```

Edit `examples/my-game/index.ts` and update the package.json script to point at it.

## Step 5: Define Tools (Character Actions)

Tools are the most important part. They define what characters CAN DO. Good tools = interesting characters.

```typescript
getTools() {
  return [{
    definition: {
      name: 'search_area',
      description: 'Search the current area for items or clues',
      parameters: [
        // 'enum' restricts the LLM to these exact values
        {
          name: 'method',
          type: 'string',
          description: 'How to search',
          enum: ['careful', 'quick', 'thorough'],
          required: true,
        },
        // 'range' auto-clamps out-of-range values
        {
          name: 'duration',
          type: 'number',
          description: 'Minutes to spend (1-30)',
          range: { min: 1, max: 30 },
          required: false,  // optional parameter
        },
      ],
    },
    executor: (args) => {
      // SUCCESS: Tell the character what happened
      if (args.method === 'thorough') {
        return {
          success: true,
          result: 'Found a hidden passage behind the bookshelf!',
          // sideEffects notify other characters
          sideEffects: [{
            type: 'discovery',
            data: { what: 'hidden passage', where: 'library' },
            timestamp: Date.now(),
          }],
        };
      }

      // FAILURE: Characters learn from failures and adjust
      return {
        success: false,
        error: 'The quick search turned up nothing interesting.',
      };
    },
  }];
}
```

### Parameter Types

| Type | Description | Extras |
|------|------------|--------|
| `string` | Free text | Add `enum: [...]` to restrict choices |
| `number` | Numeric value | Add `range: { min, max }` for bounds |

### Tool Tips

- **Clear descriptions** help the LLM choose the right tool. Be specific.
- **2-6 tools** is the sweet spot. Too many confuses small models.
- **sideEffects** propagate to nearby characters as events they can perceive.
- **Failure results** teach characters — they'll try something different next time.

## Step 6: Wire Events Into Your Game

Events are how your game tells characters about things happening. Call `engine.injectEvent()` from your game loop:

```typescript
// Something happened in your game
await engine.injectEvent({
  type: 'combat',
  source: 'goblin-3',
  data: { description: 'A goblin attacks the village gate!' },
  importance: 8,  // 1-10. Higher = characters remember it longer
  timestamp: Date.now(),
});
```

Characters within perception range will react on their next tick. The `importance` score affects whether they form a lasting memory or forget it quickly.

**sideEffects** from tool executors also generate events automatically — when one character talks, nearby characters "hear" it.

## Step 7: Game State Integration

`getGameState()` is called every tick. Return your current world state:

```typescript
getGameState() {
  return {
    worldTime: Date.now(),
    location: 'Dragon Keep',
    nearbyEntities: ['Kira (knight)', 'Old Tom (shopkeep)', 'a stray cat'],
    recentEvents: ['The drawbridge was raised', 'A horn sounded from the north'],
    // custom: any game-specific data the LLM should know
    custom: {
      timeOfDay: 'dusk',
      weather: 'foggy',
      dangerLevel: 'high',
      // Enable RoutineManager by setting timePhase:
      // timePhase: 'evening',
    },
  };
}
```

`getProprioception()` is called per-character per tick:

```typescript
getProprioception(characterId) {
  const char = myGameState.characters[characterId];
  return {
    currentAction: char.doing,     // What they're doing right now
    location: char.position,        // Where they are
    inventory: char.items,          // What they're carrying
    status: char.conditions,        // ['poisoned', 'tired', etc.]
    energy: char.stamina / 100,     // 0-1 normalized
  };
}
```

## Step 8: Chat With Characters

Characters the player knows well enough can have direct conversations:

```typescript
// Closeness must be >= 40 (configurable)
const response = await engine.chatWith('guard-1', 'Have you seen anything suspicious?');
console.log(response.content);
// "I noticed some strange footprints near the east wall last night..."

// Boost closeness manually (normally grows from interactions)
engine.boostCloseness('guard-1', 20);
```

Closeness grows naturally when characters interact with the player. At 40+ the player can chat; at 60+ the player can delegate tasks.

## Step 9: HTTP API (For Non-Node.js Games)

If your game isn't written in Node.js, use the HTTP API:

```bash
npm run demo:api
```

Then call the REST endpoints from any language:

```bash
# Health check
curl http://localhost:3000/api/health

# List characters
curl http://localhost:3000/api/characters

# Chat with a character
curl -X POST http://localhost:3000/api/chat/guard-1 \
  -H 'Content-Type: application/json' \
  -d '{"message":"What do you see?"}'

# Inject an event
curl -X POST http://localhost:3000/api/events \
  -H 'Content-Type: application/json' \
  -d '{"event":{"type":"alarm","source":"tower","data":{"description":"Fire in the market!"},"importance":9,"timestamp":0}}'

# Get character memories
curl http://localhost:3000/api/characters/guard-1/memories

# Get engine stats
curl http://localhost:3000/api/stats
```

See [docs/api-reference.md](docs/api-reference.md) for all 30 endpoints.

## What's Next

You now have AI characters that think, remember, and act. Here's where to go deeper:

| Topic | Resource |
|-------|----------|
| Full plugin API (25+ methods) | [docs/game-plugin-guide.md](docs/game-plugin-guide.md) |
| Memory system (3-tier, fading, consolidation) | [docs/memory-system.md](docs/memory-system.md) |
| Closeness and activity tiers | [docs/proximity-system.md](docs/proximity-system.md) |
| Architecture and data flow | [docs/architecture.md](docs/architecture.md) |
| All 30 HTTP API endpoints | [docs/api-reference.md](docs/api-reference.md) |
| Provider setup (all 6) | [docs/provider-setup.md](docs/provider-setup.md) |
| vLLM on Windows | [docs/vllm-windows.md](docs/vllm-windows.md) |
| More examples | `examples/sample-game/` (tavern), `examples/game-simulations/` (3 genres) |

### Engine Features You Get For Free

All of these work automatically once your plugin is loaded:

- **3-tier memory** — working (recent), episodic (importance-scored, fading), summary (LLM-compressed)
- **Emotion system** — characters track mood and it influences decisions
- **Goal planning** — characters pursue multi-step goals
- **Gossip** — information propagates character-to-character with credibility decay
- **Reputation** — collective knowledge about characters (-100 to +100)
- **Needs** — rest, social, sustenance, safety, purpose — grow over time and drive initiative
- **Routines** — daily activity patterns tied to game time phases
- **Mood contagion** — emotions spread between nearby characters
- **Factions and hierarchy** — ranks, orders, chain-of-command, auto-succession
- **Character lifecycle** — death, cleanup, auto-respawn
