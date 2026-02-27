# Game Plugin Guide

The `GamePlugin` interface is the primary integration point between your game and the AI Character Engine. By implementing this interface, you define the characters, tools, world rules, and game state that the engine uses to drive autonomous AI character behavior.

**Source:** `src/plugin/GamePlugin.ts`

---

## Table of Contents

- [Overview](#overview)
- [Required vs Optional Methods](#required-vs-optional-methods)
- [Build Your First Plugin (Tutorial)](#build-your-first-plugin-tutorial)
- [Tool Definitions](#tool-definitions)
- [Tool Executors](#tool-executors)
- [ToolResult Format](#toolresult-format)
- [GameState Contract](#gamestate-contract)
- [CharacterProprioception](#characterproprioception)
- [Archetype Definitions](#archetype-definitions)
- [Character Definitions](#character-definitions)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Hierarchy Hooks](#hierarchy-hooks)
- [Full Working Example: Tavern Tales](#full-working-example-tavern-tales)

---

## Overview

The `GamePlugin` is the bridge between your game world and the AI Character Engine. It serves several purposes:

1. **Defines what characters can do** -- through tool definitions and executors.
2. **Provides world context** -- through game state and proprioception.
3. **Establishes character templates** -- through archetypes and initial character definitions.
4. **Reacts to engine events** -- through lifecycle hooks (character added/removed, tier changes, decisions).
5. **Controls event flow** -- through event filtering and importance scoring.
6. **Manages population** -- through death/respawn hooks and target population.
7. **Defines social structures** -- through hierarchy definitions and succession hooks.

The engine calls your plugin methods during its tick cycle. Characters use your tools to interact with the game world, and your plugin receives callbacks when characters make decisions.

---

## Required vs Optional Methods

| Method | Required | Description |
|--------|----------|-------------|
| `id` | Yes | Unique string identifier for this plugin |
| `name` | Yes | Human-readable plugin name |
| `getArchetypes()` | Yes | Return available character archetypes |
| `getTools()` | Yes | Return tool definitions and executor functions |
| `getGameState()` | Yes | Return current global game state snapshot |
| `getProprioception(characterId)` | Yes | Return a character's self-knowledge |
| `initialize()` | No | Called when plugin is loaded |
| `shutdown()` | No | Called when plugin is unloaded |
| `getInitialCharacters()` | No | Return characters to register on startup |
| `scoreImportance(characterId, event)` | No | Custom event importance scoring (1-10) |
| `getWorldRules()` | No | World rules injected into system prompts |
| `getEventTypes()` | No | List of event types this game generates |
| `onCharacterAction(characterId, action, args)` | No | Called when a character makes a decision |
| `onSlowTick(timestamp)` | No | Called every slow tick |
| `onFastTick(timestamp)` | No | Called every fast tick |
| `onCharacterAdded(character)` | No | Called when a character is registered |
| `onCharacterRemoved(characterId)` | No | Called when a character is removed |
| `onTierChanged(characterId, oldTier, newTier)` | No | Called when activity tier changes |
| `beforeDecision(characterId, request)` | No | Pre-decision hook; return `false` to skip |
| `afterDecision(characterId, result)` | No | Post-decision hook |
| `filterEvent(characterId, event)` | No | Return `false` to suppress an event for a character |
| `spawnReplacement(diedCharId)` | No | Provide a replacement when a character dies |
| `getTargetPopulation()` | No | Target character count for auto-respawn |
| `getHierarchyDefinitions()` | No | Define factions and rank structures |
| `onSuccession(factionId, vacatedRank, candidates)` | No | Custom succession logic when a leader vacates |

---

## Build Your First Plugin (Tutorial)

This step-by-step guide walks you through creating a minimal working plugin.

### Step 1: Create the Plugin File

Create a new TypeScript file for your game plugin:

```typescript
import type {
  GamePlugin,
  ArchetypeDefinition,
  ToolDefinition,
  ToolResult,
  GameState,
  CharacterProprioception,
  CharacterDefinition,
} from 'ai-character-engine'; // or relative path to src/index
import type { ToolExecutorFn } from 'ai-character-engine/tools/ToolRegistry';
```

### Step 2: Define Your Game State

Keep your game's mutable state in a module-level object:

```typescript
const gameState = {
  timeOfDay: 'morning' as 'morning' | 'afternoon' | 'evening' | 'night',
  weather: 'clear',
  recentEvents: [] as string[],
};
```

### Step 3: Implement the Required Methods

```typescript
const myPlugin: GamePlugin = {
  id: 'my-game',
  name: 'My Game',

  getArchetypes(): ArchetypeDefinition[] {
    return [
      {
        id: 'villager',
        name: 'Villager',
        description: 'A common villager going about daily life',
        defaultIdentity: {
          personality: 'Friendly and hardworking.',
          backstory: 'Born and raised in the village.',
          goals: ['Live a good life', 'Help neighbors'],
          traits: ['kind', 'practical'],
        },
      },
    ];
  },

  getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
    return [
      {
        definition: {
          name: 'gather_resources',
          description: 'Gather resources from the environment',
          parameters: [
            {
              name: 'resource',
              type: 'string',
              description: 'What to gather',
              enum: ['wood', 'stone', 'herbs'],
              required: true,
            },
          ],
        },
        executor: (args) => {
          const msg = `Gathered some ${args.resource}`;
          gameState.recentEvents.push(msg);
          return { success: true, result: msg };
        },
      },
    ];
  },

  getGameState(): GameState {
    return {
      worldTime: Date.now(),
      location: 'Village Square',
      nearbyEntities: ['villager_1', 'villager_2'],
      recentEvents: gameState.recentEvents.slice(-3),
      custom: {
        timeOfDay: gameState.timeOfDay,
        weather: gameState.weather,
      },
    };
  },

  getProprioception(characterId: string): CharacterProprioception {
    return {
      currentAction: 'idle',
      location: 'village square',
      inventory: ['basic tools'],
      status: ['healthy'],
    };
  },
};
```

### Step 4: Add Initial Characters (Optional)

```typescript
  getInitialCharacters(): CharacterDefinition[] {
    return [
      {
        id: 'farmer_joe',
        name: 'Joe',
        archetype: 'villager',
        identity: {
          personality: 'Cheerful and talkative. Loves sharing farming tips.',
          backstory: 'Third-generation farmer on the family plot.',
          goals: ['Have a good harvest', 'Find a wife'],
          traits: ['optimistic', 'hardworking', 'social'],
          speechStyle: 'Folksy and warm. Uses farming metaphors.',
        },
        initialCloseness: 20,
      },
    ];
  },
```

### Step 5: Load the Plugin into the Engine

```typescript
import { Engine } from 'ai-character-engine';

const engine = new Engine(config);
await engine.loadPlugin(myPlugin);
engine.start();
```

---

## Tool Definitions

Tools are the actions characters can take in your game world. Each tool has a definition (what the LLM sees) and an executor (what actually happens).

### ToolDefinition Format

```typescript
interface ToolDefinition {
  name: string;                      // Unique tool name (snake_case recommended)
  description: string;               // What this tool does (shown to LLM)
  parameters: ToolParameter[];       // Input parameters
  requiredTier?: ActivityTier;       // Minimum tier: 'active' | 'background' | 'dormant'
  minCloseness?: number;             // Minimum closeness to player (0-100)
  category?: string;                 // Grouping category (for organization)
  cooldownMs?: number;               // Minimum time between uses
}
```

### ToolParameter Format

```typescript
interface ToolParameter {
  name: string;                      // Parameter name
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;               // Shown to LLM
  required?: boolean;                // Whether parameter is mandatory
  enum?: string[];                   // Allowed values (string type only)
  default?: unknown;                 // Default value if not provided
  min?: number;                      // Minimum value (number type only)
  max?: number;                      // Maximum value (number type only)
  maxLength?: number;                // Maximum string length
  maxItems?: number;                 // Maximum array size
}
```

### Example Tool Definition

```typescript
{
  name: 'trade_item',
  description: 'Offer to trade an item with another character',
  parameters: [
    {
      name: 'item',
      type: 'string',
      description: 'The item to offer for trade',
      required: true,
      maxLength: 100,
    },
    {
      name: 'price',
      type: 'number',
      description: 'Asking price in gold',
      required: true,
      min: 1,
      max: 10000,
    },
    {
      name: 'buyer',
      type: 'string',
      description: 'Who to trade with',
      required: true,
    },
  ],
  category: 'commerce',
  cooldownMs: 5000,
}
```

### Tool Budget by Activity Tier

The engine limits how many tools each character sees based on their activity tier:

| Tier | Max Tools | Rotation |
|------|-----------|----------|
| Active | 6 (all available) | No rotation needed |
| Background | 2 | Round-robin across full tool set |
| Dormant | 1 | Round-robin across full tool set |

Round-robin rotation ensures that even dormant characters cycle through all available tools over time.

---

## Tool Executors

The executor is a function that runs when a character uses a tool. It receives the parsed arguments and returns a `ToolResult`.

### Signature

```typescript
type ToolExecutorFn = (
  args: Record<string, unknown>,
  context?: ToolExecutionContext
) => ToolResult | Promise<ToolResult>;
```

The optional `context` parameter provides information about the character executing the tool:

```typescript
interface ToolExecutionContext {
  characterId: string;
  characterName: string;
  activityTier: ActivityTier;
  closeness: number;
  gameState?: GameState;
  proprioception?: CharacterProprioception;
}
```

### Example Executor

```typescript
executor: (args, context) => {
  const item = args.item as string;
  const price = args.price as number;
  const buyer = args.buyer as string;

  // Validate game-side logic
  if (price > playerGold) {
    return { success: false, error: `${buyer} cannot afford ${price} gold` };
  }

  // Execute the trade
  playerGold -= price;
  const msg = `Sold ${item} to ${buyer} for ${price} gold`;

  return {
    success: true,
    result: msg,
    sideEffects: [
      {
        type: 'trade_completed',
        source: context?.characterId,
        target: buyer,
        data: { item, price },
        timestamp: Date.now(),
      },
    ],
  };
},
```

---

## ToolResult Format

Every tool executor must return a `ToolResult`:

```typescript
interface ToolResult {
  success: boolean;       // Whether the action succeeded
  result?: unknown;       // Success message/data (shown to character as feedback)
  error?: string;         // Error message if success is false
  sideEffects?: GameEvent[]; // Events to inject back into the engine
}
```

### Side Effects

Side effects are `GameEvent` objects that the engine processes after the tool executes. They flow through the normal event pipeline -- other characters can perceive and react to them.

```typescript
sideEffects: [
  {
    type: 'mood_change',           // Event type
    source: 'bard',                // Who caused it
    target: undefined,             // Optional target character
    data: { newMood: 'lively' },   // Arbitrary event data
    importance: 5,                 // Optional importance (1-10)
    timestamp: Date.now(),
  },
],
```

---

## GameState Contract

`getGameState()` is called every tick to provide characters with world context. It must return a `GameState` object:

```typescript
interface GameState {
  worldTime: number;                     // Timestamp or game clock
  location?: string;                     // Current location description
  nearbyEntities?: string[];             // Entities in the vicinity
  recentEvents?: string[];               // Recent events (human-readable)
  custom?: Record<string, unknown>;      // Game-specific data
}
```

### Best Practices

- Keep `recentEvents` short (last 3-5 events). The engine has its own memory system.
- Use `custom` for game-specific state like time of day, weather, economy data.
- `nearbyEntities` should list character names and notable objects. This is used by the prompt builder to give characters spatial awareness.
- If your game provides `custom.timePhase` (a string like `'morning'`, `'evening'`), the `RoutineManager` uses it to drive phase-based daily activities.

### Example

```typescript
getGameState(): GameState {
  return {
    worldTime: Date.now(),
    location: 'The Rusty Flagon Tavern',
    nearbyEntities: ['Greta (barkeep)', 'Fynn (merchant)', 'several patrons'],
    recentEvents: [
      'A mysterious stranger entered the tavern',
      'Greta served ale to a patron',
    ],
    custom: {
      timeOfDay: 'evening',
      timePhase: 'evening',     // Used by RoutineManager
      patronCount: 5,
      mood: 'lively',
    },
  };
},
```

---

## CharacterProprioception

`getProprioception(characterId)` gives each character self-knowledge -- what they are doing, where they are, what they have. This is called every tick for each character making a decision.

```typescript
interface CharacterProprioception {
  currentAction?: string;                // What the character is doing right now
  location?: string;                     // Where the character is
  inventory?: string[];                  // Items the character has
  status?: string[];                     // Status effects (e.g., 'tired', 'alert')
  energy?: number;                       // Energy level (0-1)
  custom?: Record<string, unknown>;      // Game-specific self-knowledge
}
```

### Example

```typescript
getProprioception(characterId: string): CharacterProprioception {
  const charState = characterStates[characterId];
  if (!charState) return {};
  return {
    currentAction: charState.action,
    location: charState.location,
    inventory: charState.inventory,
    status: charState.status,
    energy: charState.energy,
    custom: {
      gold: charState.gold,
      reputation: charState.reputation,
    },
  };
},
```

---

## Archetype Definitions

Archetypes are character templates. They define personality defaults that can be overridden by individual character definitions.

```typescript
interface ArchetypeDefinition {
  id: string;                    // Unique archetype identifier
  name: string;                  // Human-readable name
  description: string;           // What this archetype represents
  defaultIdentity: {
    personality: string;         // Default personality description
    backstory: string;           // Default backstory
    goals: string[];             // Default goals
    traits: string[];            // Default personality traits
  };
}
```

### Example

```typescript
{
  id: 'merchant',
  name: 'Merchant',
  description: 'Traveling trader with exotic wares and information',
  defaultIdentity: {
    personality: 'Shrewd and calculating but fair. Values good deals.',
    backstory: 'Travels the trade routes, stops at the tavern regularly.',
    goals: ['Find profitable trades', 'Gather information', 'Build trade network'],
    traits: ['cunning', 'charming', 'well-traveled', 'opportunistic'],
  },
}
```

---

## Character Definitions

Individual characters are defined with a `CharacterDefinition`. Each character references an archetype and can override the archetype's defaults.

```typescript
interface CharacterDefinition {
  id: string;                            // Unique character identifier
  name: string;                          // Character name
  archetype: string;                     // Must match an archetype id
  identity: CharacterIdentity;           // Personality, backstory, goals, traits
  initialCloseness?: number;             // Starting closeness to player (0-100)
  metadata?: Record<string, unknown>;    // Arbitrary metadata
}

interface CharacterIdentity {
  personality: string;
  backstory: string;
  goals: string[];
  traits: string[];
  speechStyle?: string;                  // How the character speaks
  quirks?: string[];                     // Behavioral quirks
}
```

### Closeness and Activity Tiers

A character's `initialCloseness` determines their starting activity tier:

| Closeness | Tier | Behavior |
|-----------|------|----------|
| >= 60 | Active | Decides every fast tick, full tool access |
| 20-59 | Background | Decides every slow tick, limited tools |
| < 20 | Dormant | Decides every slow tick, minimal tools |

Characters at closeness >= 40 can be chatted with via `engine.chatWith()`. Characters at closeness >= 60 can receive delegated orders.

---

## Lifecycle Hooks

Lifecycle hooks let your plugin react to engine events. All are optional.

### `initialize()` / `shutdown()`

Called when the plugin is loaded and unloaded. Use for setup and cleanup.

```typescript
initialize() {
  console.log('Plugin loaded, initializing game state...');
  loadSavedGameState();
},

shutdown() {
  console.log('Plugin shutting down, saving game state...');
  saveGameState();
},
```

### `onCharacterAdded(character)` / `onCharacterRemoved(characterId)`

Called when characters are registered or removed from the engine.

```typescript
onCharacterAdded(character) {
  // Initialize game-side state for this character
  characterStates[character.id] = {
    location: 'spawn_point',
    action: 'arriving',
    status: ['new'],
    inventory: [],
  };
},

onCharacterRemoved(characterId) {
  delete characterStates[characterId];
},
```

### `onTierChanged(characterId, oldTier, newTier)`

Called when a character's activity tier changes due to closeness shifts.

```typescript
onTierChanged(characterId, oldTier, newTier) {
  if (newTier === 'active') {
    // Character is now close to player -- enable detailed behaviors
  } else if (newTier === 'dormant') {
    // Character drifted away -- reduce game-side simulation
  }
},
```

### `beforeDecision(characterId, request)` / `afterDecision(characterId, result)`

Pre- and post-decision hooks. `beforeDecision` can return `false` to skip a character's decision this tick.

```typescript
beforeDecision(characterId, request) {
  // Skip decisions for sleeping characters
  if (characterStates[characterId]?.status.includes('sleeping')) {
    return false;
  }
},

afterDecision(characterId, result) {
  // Update game-side state based on what the character decided
  if ('toolName' in result.action) {
    console.log(`${characterId} used tool: ${result.action.toolName}`);
  }
},
```

### `filterEvent(characterId, event)`

Return `false` to prevent a character from perceiving an event.

```typescript
filterEvent(characterId, event) {
  // Characters in the basement don't hear tavern events
  if (characterStates[characterId]?.location === 'basement') {
    return event.type === 'earthquake'; // Only earthquakes reach the basement
  }
  return true;
},
```

### `onSlowTick(timestamp)` / `onFastTick(timestamp)`

Called every slow tick (default 30s) and fast tick (default 2s). Use for game-side simulation updates.

```typescript
onSlowTick(timestamp) {
  // Advance time of day
  advanceTimeOfDay();
  // Spawn random events
  if (Math.random() < 0.1) {
    spawnRandomEvent();
  }
},
```

### `scoreImportance(characterId, event)`

Custom importance scoring for events. Return a number 1-10, or `undefined` to use the engine's default scoring.

```typescript
scoreImportance(characterId, event) {
  // Bar fights are critical for guards
  if (event.type === 'bar_fight' && characterId === 'guard') return 9;
  // Song requests are important to bards
  if (event.type === 'song_request' && characterId === 'bard') return 7;
  return undefined; // Use default scoring
},
```

### `spawnReplacement(diedCharId)` / `getTargetPopulation()`

Used by the `LifecycleManager` when a character dies.

```typescript
spawnReplacement(diedCharId) {
  // Provide a specific replacement
  return {
    id: `replacement_${Date.now()}`,
    name: generateRandomName(),
    archetype: 'villager',
    identity: {
      personality: 'Newly arrived in town.',
      backstory: 'Heard there was an opening at the tavern.',
      goals: ['Find work', 'Make friends'],
      traits: ['curious', 'eager'],
    },
  };
  // Or return null to let the engine use random archetype fallback
},

getTargetPopulation() {
  return 4; // Engine will auto-respawn to maintain this count
},
```

---

## Hierarchy Hooks

The `HierarchyManager` supports factions with ranked memberships. Your plugin defines the structure; the engine manages assignments, orders, and succession.

### `getHierarchyDefinitions()`

Define factions and their rank structures:

```typescript
getHierarchyDefinitions() {
  return [
    {
      factionId: 'town_guard',
      factionName: 'Town Guard',
      ranks: [
        { level: 0, name: 'Captain', maxMembers: 1 },
        { level: 1, name: 'Sergeant', maxMembers: 3 },
        { level: 2, name: 'Guard' },
      ],
    },
    {
      factionId: 'merchants_guild',
      factionName: "Merchants' Guild",
      ranks: [
        { level: 0, name: 'Guildmaster', maxMembers: 1 },
        { level: 1, name: 'Senior Merchant', maxMembers: 5 },
        { level: 2, name: 'Merchant' },
        { level: 3, name: 'Apprentice' },
      ],
    },
  ];
},
```

### `onSuccession(factionId, vacatedRank, candidates)`

Called when a ranked member dies or is removed. Return a `characterId` to promote, or `null` for the engine's score-based fallback.

```typescript
onSuccession(factionId, vacatedRank, candidates) {
  if (factionId === 'town_guard' && vacatedRank === 0) {
    // Always promote the most trusted guard to Captain
    const mostTrusted = candidates.sort((a, b) => b.score - a.score)[0];
    return mostTrusted?.characterId ?? null;
  }
  return null; // Let engine handle other factions
},
```

### How Hierarchy Affects Characters

- Characters receive their rank and faction in their prompt context.
- Superior characters can issue orders to subordinates via the chain of command.
- Orders are injected into the subordinate's prompt as instructions to follow.
- The `InitiativeChecker` can trigger decisions when a character receives an order.

---

## Full Working Example: Tavern Tales

Below is the complete "Tavern Tales" sample game plugin from `examples/sample-game/index.ts`. This is a fully functional plugin that demonstrates archetypes, tools, game state, proprioception, event scoring, and world rules.

```typescript
import { Engine, loadConfigFile } from '../../src/index';
import type {
  GamePlugin,
  ArchetypeDefinition,
  CharacterDefinition,
  ToolDefinition,
  ToolResult,
  GameState,
  CharacterProprioception,
  GameEvent,
  EngineConfig,
} from '../../src/index';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';

// ============================================================
// Game State
// ============================================================

const tavernState = {
  timeOfDay: 'evening' as 'morning' | 'afternoon' | 'evening' | 'night',
  patronCount: 5,
  mood: 'lively' as 'quiet' | 'lively' | 'rowdy' | 'tense',
  recentEvents: [] as string[],
  inventory: {
    ale: 20,
    wine: 10,
    bread: 15,
    stew: 8,
  },
  gold: 100,
};

const characterStates: Record<string, {
  location: string;
  action: string;
  status: string[];
  inventory: string[];
}> = {
  'barkeep': {
    location: 'behind the bar',
    action: 'polishing glasses',
    status: ['working'],
    inventory: ['towel', 'mug'],
  },
  'merchant': {
    location: 'corner table',
    action: 'reviewing ledger',
    status: ['busy'],
    inventory: ['ledger', 'coin purse', 'exotic spices'],
  },
  'bard': {
    location: 'stage area',
    action: 'tuning lute',
    status: ['relaxed'],
    inventory: ['lute', 'songbook'],
  },
  'guard': {
    location: 'near door',
    action: 'watching entrance',
    status: ['alert'],
    inventory: ['sword', 'shield', 'lantern'],
  },
};

// ============================================================
// Plugin Implementation
// ============================================================

const tavernPlugin: GamePlugin = {
  id: 'tavern-tales',
  name: 'Tavern Tales',

  initialize() {
    console.log('[Tavern Tales] Plugin initialized! Welcome to the tavern.');
  },

  shutdown() {
    console.log('[Tavern Tales] Last call! Tavern is closing.');
  },

  getArchetypes(): ArchetypeDefinition[] {
    return [
      {
        id: 'barkeep',
        name: 'Barkeep',
        description: 'Runs the tavern, serves drinks, knows everyone\'s business',
        defaultIdentity: {
          personality: 'Warm and welcoming but sharp-eyed. Keeps the peace.',
          backstory: 'Former adventurer who settled down to run the tavern.',
          goals: ['Keep the tavern profitable', 'Maintain order', 'Help regulars'],
          traits: ['observant', 'patient', 'firm', 'generous'],
        },
      },
      {
        id: 'merchant',
        name: 'Merchant',
        description: 'Traveling trader with exotic wares and information',
        defaultIdentity: {
          personality: 'Shrewd and calculating but fair. Values good deals.',
          backstory: 'Travels the trade routes, stops at the tavern regularly.',
          goals: ['Find profitable trades', 'Gather information', 'Build trade network'],
          traits: ['cunning', 'charming', 'well-traveled', 'opportunistic'],
        },
      },
      {
        id: 'bard',
        name: 'Bard',
        description: 'Entertainer who collects stories and spreads news',
        defaultIdentity: {
          personality: 'Charismatic and dramatic. Lives for a good story.',
          backstory: 'A traveling bard who found the tavern has the best tales.',
          goals: ['Collect amazing stories', 'Entertain the crowd', 'Learn secrets'],
          traits: ['creative', 'empathetic', 'dramatic', 'curious'],
        },
      },
      {
        id: 'guard',
        name: 'Guard',
        description: 'Town guard who patrols and keeps order',
        defaultIdentity: {
          personality: 'Dutiful and stern but has a soft spot for regulars.',
          backstory: 'Local guard assigned to the tavern district.',
          goals: ['Maintain order', 'Protect citizens', 'Investigate rumors'],
          traits: ['loyal', 'brave', 'suspicious', 'disciplined'],
        },
      },
    ];
  },

  getInitialCharacters(): CharacterDefinition[] {
    return [
      {
        id: 'barkeep',
        name: 'Greta',
        archetype: 'barkeep',
        identity: {
          personality: 'Warm and welcoming but sharp-eyed. Keeps the peace.',
          backstory: 'Former adventurer who retired to run the Rusty Flagon.',
          goals: ['Keep the tavern profitable', 'Maintain order', 'Help friends'],
          traits: ['observant', 'patient', 'firm', 'generous', 'nostalgic'],
          speechStyle: 'Friendly but direct. Uses tavern metaphors.',
        },
        initialCloseness: 40,
      },
      {
        id: 'merchant',
        name: 'Fynn',
        archetype: 'merchant',
        identity: {
          personality: 'Shrewd and calculating but surprisingly fair.',
          backstory: 'Son of a merchant house that fell on hard times.',
          goals: ['Rebuild the family trade empire', 'Find the lost cargo'],
          traits: ['cunning', 'charming', 'persistent', 'competitive'],
          speechStyle: 'Smooth talker. Always quantifying things.',
        },
        initialCloseness: 15,
      },
      {
        id: 'bard',
        name: 'Elara',
        archetype: 'bard',
        identity: {
          personality: 'Charismatic and dramatic. Sees the world as a story.',
          backstory: 'Ran away from a noble family to pursue music.',
          goals: ['Write the greatest ballad ever', 'Find real adventures'],
          traits: ['creative', 'empathetic', 'dramatic', 'secretive'],
          speechStyle: 'Poetic and expressive. Quotes her own songs.',
        },
        initialCloseness: 25,
      },
      {
        id: 'guard',
        name: 'Theron',
        archetype: 'guard',
        identity: {
          personality: 'Dutiful and stern outside, thoughtful inside.',
          backstory: 'Transferred after questioning his captain\'s corruption.',
          goals: ['Uncover corruption', 'Protect the innocent'],
          traits: ['loyal', 'brave', 'suspicious', 'righteous'],
          speechStyle: 'Formal and measured. Words chosen like evidence.',
        },
        initialCloseness: 10,
      },
    ];
  },

  getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
    return [
      {
        definition: {
          name: 'serve_drink',
          description: 'Serve a drink to a patron',
          parameters: [
            {
              name: 'drink',
              type: 'string',
              description: 'Type of drink',
              enum: ['ale', 'wine', 'water'],
              required: true,
            },
            {
              name: 'target',
              type: 'string',
              description: 'Who to serve',
              required: true,
            },
          ],
          category: 'tavern',
        },
        executor: (args) => {
          const drink = args.drink as string;
          if (tavernState.inventory[drink as keyof typeof tavernState.inventory] <= 0) {
            return { success: false, error: `Out of ${drink}!` };
          }
          (tavernState.inventory as any)[drink]--;
          tavernState.gold += drink === 'ale' ? 2 : drink === 'wine' ? 5 : 0;
          const msg = `Served ${drink} to ${args.target}`;
          tavernState.recentEvents.push(msg);
          return { success: true, result: msg };
        },
      },
      {
        definition: {
          name: 'tell_story',
          description: 'Tell a story or perform music for the tavern',
          parameters: [
            {
              name: 'topic',
              type: 'string',
              description: 'What the story/song is about',
              required: true,
            },
            {
              name: 'style',
              type: 'string',
              description: 'Performance style',
              enum: ['dramatic', 'funny', 'mysterious', 'heroic'],
              required: true,
            },
          ],
          category: 'entertainment',
        },
        executor: (args) => {
          const effect = args.style === 'funny' ? 'lively'
            : args.style === 'mysterious' ? 'quiet' : 'lively';
          tavernState.mood = effect as any;
          const msg = `Performed a ${args.style} story about ${args.topic}`;
          tavernState.recentEvents.push(msg);
          return {
            success: true,
            result: msg,
            sideEffects: [{
              type: 'mood_change',
              data: { newMood: effect },
              timestamp: Date.now(),
            }],
          };
        },
      },
      {
        definition: {
          name: 'trade_item',
          description: 'Offer to trade an item',
          parameters: [
            { name: 'item', type: 'string', description: 'Item to trade', required: true },
            { name: 'price', type: 'number', description: 'Gold price', required: true },
            { name: 'buyer', type: 'string', description: 'Who to trade with', required: true },
          ],
          category: 'commerce',
        },
        executor: (args) => {
          const msg = `Offered ${args.item} to ${args.buyer} for ${args.price} gold`;
          tavernState.recentEvents.push(msg);
          return { success: true, result: msg };
        },
      },
      {
        definition: {
          name: 'patrol',
          description: 'Patrol an area of the tavern',
          parameters: [
            {
              name: 'area',
              type: 'string',
              description: 'Area to patrol',
              enum: ['entrance', 'bar', 'tables', 'back_room'],
              required: true,
            },
          ],
          category: 'security',
        },
        executor: (args) => {
          const discoveries: Record<string, string> = {
            entrance: 'The entrance is clear. A cold draft blows in.',
            bar: 'Everything seems normal at the bar.',
            tables: 'A few patrons look like they\'ve had too much.',
            back_room: 'You notice some suspicious markings on the wall...',
          };
          const msg = discoveries[args.area as string] ?? 'Nothing to report.';
          tavernState.recentEvents.push(`Guard patrolled ${args.area}: ${msg}`);
          return { success: true, result: msg };
        },
      },
      {
        definition: {
          name: 'observe',
          description: 'Carefully observe someone or something',
          parameters: [
            {
              name: 'target',
              type: 'string',
              description: 'What/who to observe',
              required: true,
            },
          ],
          category: 'social',
        },
        executor: (args) => {
          const msg = `Observed ${args.target} carefully`;
          tavernState.recentEvents.push(msg);
          return {
            success: true,
            result: `You take a careful look at ${args.target}.`,
          };
        },
      },
    ];
  },

  getGameState(): GameState {
    return {
      worldTime: Date.now(),
      location: 'The Rusty Flagon Tavern',
      nearbyEntities: [
        'Greta (barkeep)',
        'Fynn (merchant)',
        'Elara (bard)',
        'Theron (guard)',
        'several patrons',
      ],
      recentEvents: tavernState.recentEvents.slice(-3),
      custom: {
        timeOfDay: tavernState.timeOfDay,
        patronCount: tavernState.patronCount,
        mood: tavernState.mood,
        tavernGold: tavernState.gold,
      },
    };
  },

  getProprioception(characterId: string): CharacterProprioception {
    const state = characterStates[characterId];
    if (!state) return {};
    return {
      currentAction: state.action,
      location: state.location,
      inventory: state.inventory,
      status: state.status,
    };
  },

  scoreImportance(characterId: string, event: GameEvent): number | undefined {
    if (event.type === 'bar_fight') {
      if (characterId === 'guard') return 9;
      if (characterId === 'barkeep') return 8;
      return 5;
    }
    if (event.type === 'song_request' && characterId === 'bard') return 7;
    return undefined;
  },

  getWorldRules(): string {
    return 'This is a medieval fantasy tavern. No modern technology. Gold is the currency.';
  },

  getEventTypes(): string[] {
    return [
      'customer_arrives',
      'bar_fight',
      'song_request',
      'trade_offer',
      'suspicious_activity',
      'last_call',
    ];
  },
};

// ============================================================
// Running the Plugin
// ============================================================

async function main() {
  const config: EngineConfig = {
    database: { path: './data/tavern.db' },
    inference: {
      type: 'ollama',
      models: {
        heavy: 'qwen2.5:7b',
        mid: 'qwen2.5:7b',
        light: 'qwen2.5:1.5b',
      },
    },
    proximity: {},
    tick: { fastTickMs: 5000, slowTickMs: 60000, batchSize: 4 },
    memory: {
      workingMemorySize: 5,
      episodicRetrievalCount: 3,
      importanceThreshold: 3,
      decayInterval: 10,
      pruneThreshold: 0.5,
      summaryRegenerateInterval: 50,
    },
    logging: { level: 'info', pretty: true },
  };

  const engine = new Engine(config);
  await engine.loadPlugin(tavernPlugin);

  // Listen for decisions
  engine.events.on('agent:decision', (result) => {
    const action = 'toolName' in result.action
      ? `[TOOL] ${result.action.toolName}(${JSON.stringify(result.action.arguments)})`
      : result.action.type === 'dialogue'
        ? `[SAYS] "${(result.action as any).content}"`
        : '[IDLE]';
    console.log(`${result.characterId}: ${action}`);
  });

  engine.start();

  // Inject an event
  await engine.injectEvent({
    type: 'customer_arrives',
    source: 'player',
    data: { name: 'A mysterious stranger in a dark cloak' },
    timestamp: Date.now(),
  });

  // Let it run...
  await new Promise(resolve => setTimeout(resolve, 30000));
  await engine.stop();
}

main().catch(console.error);
```

### Running the Example

```bash
npx tsx examples/sample-game/index.ts
```

Make sure you have a provider running (Ollama is easiest -- see `docs/provider-setup.md`) and your model is available before starting.
