/**
 * ============================================================
 * MY FIRST PLUGIN — "Quiet Village"
 * ============================================================
 *
 * A minimal but complete game plugin that teaches you every concept.
 * Two characters (a farmer and a blacksmith) live in a village,
 * gathering resources, crafting items, and talking to each other.
 *
 * HOW TO RUN:
 *   npm run demo:starter
 *
 * HOW TO CUSTOMIZE:
 *   1. Change the archetypes (Step 2) to fit your game's character types
 *   2. Change the tools (Step 3) to match what characters CAN DO
 *   3. Change the game state (Step 4) to match what characters CAN SEE
 *   4. Change the characters (Step 5) to populate your world
 *
 * DATA FLOW:
 *   Your Game → Plugin Methods → Engine (ticks) → LLM (decides)
 *        ↑                                            |
 *        └──── Tool Executor (modifies game) ←────────┘
 *
 * The engine calls your plugin's methods each tick to get fresh state,
 * sends it to the LLM, and the LLM picks a tool to call. Your tool
 * executor runs the action and returns the result.
 */

// ============================================================
// STEP 1: Imports
// ============================================================
// Engine is the main class. loadConfigFile reads engine.config.json.
// The type imports define the shapes your plugin must return.

import { Engine, loadConfigFile } from '../../src/index';
import type {
  GamePlugin,
  ArchetypeDefinition,
  CharacterDefinition,
  ToolDefinition,
  ToolResult,
  GameState,
  CharacterProprioception,
  EngineConfig,
} from '../../src/index';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';

// ============================================================
// STEP 2: Game State
// ============================================================
// This is YOUR game's state — it can be anything. The engine never
// touches it directly. Your plugin reads from it (getGameState) and
// your tool executors write to it (when the LLM picks an action).

const village = {
  time: 'morning' as 'morning' | 'afternoon' | 'evening' | 'night',
  weather: 'clear' as 'clear' | 'rain' | 'storm',
  resources: {
    wood: 10,
    iron: 5,
    wheat: 20,
    bread: 3,
  },
  recentEvents: [] as string[],
};

// Per-character state. You track this however you want.
const characters: Record<string, {
  location: string;
  activity: string;
  inventory: string[];
  health: number;
  energy: number;
}> = {
  'farmer-1': {
    location: 'wheat field',
    activity: 'tending crops',
    inventory: ['hoe', 'waterskin'],
    health: 100,
    energy: 80,
  },
  'smith-1': {
    location: 'forge',
    activity: 'heating the furnace',
    inventory: ['hammer', 'tongs', 'iron ingot'],
    health: 100,
    energy: 70,
  },
};

// Helper to push an event and keep only the last 5
function addEvent(msg: string): void {
  village.recentEvents.push(msg);
  if (village.recentEvents.length > 5) village.recentEvents.shift();
}

// ============================================================
// STEP 3: Plugin Implementation
// ============================================================
// The GamePlugin interface is the contract between your game and the
// engine. You MUST implement: getArchetypes, getTools, getGameState,
// getProprioception. Everything else is optional.

const villagePlugin: GamePlugin = {
  // Unique identifier — used internally for namespacing
  id: 'quiet-village',

  // Human-readable name — shown in logs
  name: 'Quiet Village',

  // ----------------------------------------------------------
  // OPTIONAL: Called once when the plugin is loaded.
  // Use this to initialize game state, connect to databases, etc.
  // ----------------------------------------------------------
  initialize() {
    console.log('[Village] Plugin initialized! The village awakens.');
  },

  // ----------------------------------------------------------
  // REQUIRED: Archetypes are character TEMPLATES.
  // Each archetype defines a "type" of character with default
  // personality, backstory, goals, and traits. Individual characters
  // can override any of these when you define them in Step 5.
  // ----------------------------------------------------------
  getArchetypes(): ArchetypeDefinition[] {
    return [
      {
        id: 'farmer',
        name: 'Farmer',
        description: 'Grows crops and gathers resources for the village',
        defaultIdentity: {
          // Personality: How the character thinks and acts
          personality: 'Hardworking and practical. Prefers simple solutions.',
          // Backstory: The character's history (shapes their perspective)
          backstory: 'Third-generation farmer. Knows the land like the back of their hand.',
          // Goals: What the character is trying to achieve (drives decisions)
          goals: ['Keep the village fed', 'Prepare for winter'],
          // Traits: Keywords that flavor behavior
          traits: ['patient', 'resourceful', 'stubborn'],
        },
      },
      {
        id: 'blacksmith',
        name: 'Blacksmith',
        description: 'Crafts tools and weapons from raw materials',
        defaultIdentity: {
          personality: 'Focused and proud of their craft. Speaks bluntly.',
          backstory: 'Apprenticed under a master smith in the city before moving to this village.',
          goals: ['Craft the finest blade in the region', 'Train an apprentice'],
          traits: ['precise', 'strong', 'perfectionist'],
        },
      },
    ];
  },

  // ----------------------------------------------------------
  // REQUIRED: Tools define what characters CAN DO.
  // Each tool has a definition (name, description, parameters) and
  // an executor function. The LLM reads the definitions and picks
  // one to call. The executor runs the actual game logic.
  //
  // TIPS for good tool design:
  // - Clear descriptions help the LLM choose the right tool
  // - Use 'enum' for fixed choices (the LLM sees the options)
  // - Use 'range' for numbers (the engine clamps out-of-range values)
  // - Return { success: false, error: "..." } for failures
  // - Use sideEffects to propagate changes to other characters
  // ----------------------------------------------------------
  getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
    return [
      // TOOL 1: gather — collect resources from the world
      {
        definition: {
          name: 'gather',
          description: 'Gather a resource from the environment',
          parameters: [
            {
              name: 'resource',
              type: 'string',
              description: 'What to gather',
              // 'enum' restricts the LLM to these exact values
              enum: ['wood', 'iron', 'wheat'],
              required: true,
            },
            {
              name: 'effort',
              type: 'number',
              description: 'How much effort to put in (1=light, 5=maximum)',
              // 'range' lets the engine auto-clamp invalid values
              range: { min: 1, max: 5 },
              required: true,
            },
          ],
          // Category is optional — helps organize tools in large games
          category: 'work',
        },
        executor: (args): ToolResult => {
          const resource = args.resource as string;
          const effort = args.effort as number;
          const amount = Math.ceil(effort * 1.5);

          // Mutate your game state
          village.resources[resource as keyof typeof village.resources] += amount;
          addEvent(`Gathered ${amount} ${resource}`);

          return {
            success: true,
            result: `Gathered ${amount} ${resource}. Village now has ${village.resources[resource as keyof typeof village.resources]}.`,
          };
        },
      },

      // TOOL 2: talk_to — communicate with another character
      {
        definition: {
          name: 'talk_to',
          description: 'Say something to another character nearby',
          parameters: [
            {
              name: 'target',
              type: 'string',
              description: 'Name of the character to talk to',
              required: true,
            },
            {
              name: 'message',
              type: 'string',
              description: 'What to say',
              required: true,
            },
          ],
          category: 'social',
        },
        executor: (args): ToolResult => {
          const msg = `Said to ${args.target}: "${args.message}"`;
          addEvent(msg);

          return {
            success: true,
            result: msg,
            // sideEffects notify OTHER characters about this action.
            // The engine converts these into events that nearby
            // characters perceive on their next tick.
            sideEffects: [{
              type: 'speech',
              data: { speaker: 'unknown', target: args.target, message: args.message },
              timestamp: Date.now(),
            }],
          };
        },
      },

      // TOOL 3: craft — transform resources into items
      {
        definition: {
          name: 'craft',
          description: 'Craft an item from available resources',
          parameters: [
            {
              name: 'item',
              type: 'string',
              description: 'What to craft',
              enum: ['bread', 'iron_tool', 'horseshoe'],
              required: true,
            },
          ],
          category: 'work',
        },
        executor: (args): ToolResult => {
          const item = args.item as string;

          // Crafting recipes — check resources and fail gracefully
          const recipes: Record<string, Record<string, number>> = {
            bread: { wheat: 3 },
            iron_tool: { iron: 2, wood: 1 },
            horseshoe: { iron: 1 },
          };

          const recipe = recipes[item];
          if (!recipe) {
            // Return failure — the LLM learns from failures and adjusts
            return { success: false, error: `Unknown recipe: ${item}` };
          }

          // Check if we have enough resources
          for (const [res, needed] of Object.entries(recipe)) {
            const available = village.resources[res as keyof typeof village.resources] ?? 0;
            if (available < needed) {
              return {
                success: false,
                error: `Not enough ${res} (need ${needed}, have ${available})`,
              };
            }
          }

          // Consume resources
          for (const [res, needed] of Object.entries(recipe)) {
            (village.resources as any)[res] -= needed;
          }

          addEvent(`Crafted ${item}`);

          return {
            success: true,
            result: `Crafted 1 ${item}. Resources remaining: wood=${village.resources.wood}, iron=${village.resources.iron}, wheat=${village.resources.wheat}`,
            sideEffects: [{
              type: 'craft_complete',
              data: { item, crafter: 'unknown' },
              timestamp: Date.now(),
            }],
          };
        },
      },
    ];
  },

  // ----------------------------------------------------------
  // REQUIRED: What characters CAN SEE about the world.
  // Called every tick. Return the current state of the world.
  // Keep it concise — this goes into the LLM prompt.
  // ----------------------------------------------------------
  getGameState(): GameState {
    return {
      // worldTime: used by the engine for scheduling
      worldTime: Date.now(),

      // location: where the action is happening
      location: 'Quiet Village',

      // nearbyEntities: who/what is nearby (characters see this list)
      nearbyEntities: ['Elden (farmer)', 'Brynn (blacksmith)', 'a few villagers'],

      // recentEvents: what just happened (gives characters context)
      recentEvents: village.recentEvents.slice(-3),

      // custom: ANY game-specific data you want characters to know about.
      // This is injected into the prompt as-is.
      custom: {
        timeOfDay: village.time,
        weather: village.weather,
        resources: { ...village.resources },
        // TIP: Set 'timePhase' to enable the RoutineManager.
        // Characters will follow daily routines based on this value.
        // timePhase: village.time,
      },
    };
  },

  // ----------------------------------------------------------
  // REQUIRED: What each character KNOWS ABOUT THEMSELVES.
  // Called per-character per tick. Return their personal state.
  // ----------------------------------------------------------
  getProprioception(characterId: string): CharacterProprioception {
    const state = characters[characterId];
    if (!state) {
      // Fallback for unknown characters
      return { currentAction: 'idle', location: 'village' };
    }
    return {
      currentAction: state.activity,
      location: state.location,
      inventory: state.inventory,
      status: state.health > 50 ? ['healthy'] : ['tired'],
      energy: state.energy / 100,  // Normalized 0-1
    };
  },

  // ----------------------------------------------------------
  // OPTIONAL: Initial characters to spawn when the plugin loads.
  // If omitted, you can add characters later via engine.addCharacter().
  // Each character references an archetype and can override identity fields.
  // ----------------------------------------------------------
  getInitialCharacters(): CharacterDefinition[] {
    return [
      {
        id: 'farmer-1',
        name: 'Elden',
        archetype: 'farmer',  // Must match an archetype id from getArchetypes()
        identity: {
          // Override the archetype defaults with character-specific details
          personality: 'Quiet and thoughtful. Hums while working.',
          backstory: 'Lost his wife to illness two winters ago. Throws himself into work to cope.',
          goals: ['Grow enough wheat to last the winter', 'Help the blacksmith repair the mill'],
          traits: ['patient', 'melancholy', 'generous'],
          // speechStyle is optional but adds flavor to dialogue
          speechStyle: 'Soft-spoken. Uses farming metaphors. "Well, you reap what you sow."',
        },
        // initialCloseness: how "known" this character is to the player at start.
        // 0 = stranger, 100 = best friend. Affects activity tier.
        // >= 40 = player can chat with them, >= 60 = player can delegate tasks
        initialCloseness: 30,
      },
      {
        id: 'smith-1',
        name: 'Brynn',
        archetype: 'blacksmith',
        identity: {
          personality: 'Loud and opinionated but deeply loyal to friends.',
          backstory: 'Left the city after a falling out with the smithing guild. Seeking redemption.',
          goals: ['Prove she can forge a masterwork without the guild', 'Protect the village'],
          traits: ['proud', 'skilled', 'hot-tempered'],
          speechStyle: 'Blunt and direct. Metalworking metaphors. "Strike while the iron\'s hot!"',
        },
        initialCloseness: 20,
      },
    ];
  },

  // ----------------------------------------------------------
  // OPTIONAL: World rules are injected into every character's
  // system prompt. Use this to establish setting and boundaries.
  // ----------------------------------------------------------
  getWorldRules(): string {
    return 'Medieval village setting. No magic or modern technology. Characters should focus on daily survival tasks.';
  },

  // ----------------------------------------------------------
  // OPTIONAL: Called when a character uses a tool.
  // Use this to sync your game state with character actions.
  // ----------------------------------------------------------
  onCharacterAction(characterId: string, action: string, args: Record<string, unknown>): void {
    const state = characters[characterId];
    if (!state) return;

    // Update character energy when they work
    if (action === 'gather' || action === 'craft') {
      state.energy = Math.max(0, state.energy - 10);
      state.activity = action === 'gather'
        ? `gathering ${args.resource}`
        : `crafting ${args.item}`;
    }
  },

  // ----------------------------------------------------------
  // OPTIONAL: Called every slow tick (default: 30 seconds).
  // Use this for game-wide updates like time progression.
  // ----------------------------------------------------------
  onSlowTick(): void {
    // Advance time of day
    const phases: Array<typeof village.time> = ['morning', 'afternoon', 'evening', 'night'];
    const current = phases.indexOf(village.time);
    village.time = phases[(current + 1) % phases.length];

    // Restore some energy
    for (const state of Object.values(characters)) {
      state.energy = Math.min(100, state.energy + 5);
    }
  },
};

// ============================================================
// STEP 4: Bootstrap and Run
// ============================================================
// This is the main function that wires everything together.
// In a real game, you'd integrate this into your game loop.

async function main() {
  console.log('=== Quiet Village — My First Plugin ===\n');

  // --- Load Config ---
  // Try engine.config.json first (created by setup.bat/setup.sh).
  // If it doesn't exist, fall back to reasonable defaults.
  let config: EngineConfig;
  try {
    config = loadConfigFile();
    console.log('Loaded config from engine.config.json');
  } catch {
    console.log('No engine.config.json found — using Ollama defaults.');
    console.log('TIP: Run setup.bat (Windows) or setup.sh (Linux/Mac) to auto-generate config.\n');
    config = {
      database: { path: './data/village.db' },
      inference: {
        type: 'ollama',
        models: { heavy: 'qwen2.5:7b', mid: 'qwen2.5:7b', light: 'qwen2.5:1.5b' },
        maxConcurrency: 10,
        timeoutMs: 30000,
        maxRetries: 2,
      },
      tick: {
        fastTickMs: 3000,     // Check active characters every 3 seconds
        slowTickMs: 30000,    // Background tasks every 30 seconds
        maxAgentsPerFastTick: 15,
        maxAgentsPerSlowTick: 50,
        batchSize: 4,
      },
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
  }

  // --- Create Engine ---
  const engine = new Engine(config);

  // --- Load Plugin ---
  // This registers your archetypes, tools, and spawns initial characters.
  await engine.loadPlugin(villagePlugin);

  // --- Listen for Events ---
  // The engine emits events you can use to update your game UI.
  engine.events.on('agent:decision', (result) => {
    const action = 'toolName' in result.action
      ? `[ACTION] ${result.action.toolName}(${JSON.stringify(result.action.arguments)})`
      : result.action.type === 'dialogue'
        ? `[SAYS] "${(result.action as any).content}"`
        : '[IDLE]';
    console.log(`  ${result.characterId}: ${action}`);
  });

  // --- Health Check ---
  // Verify the LLM provider is reachable before starting.
  const health = await engine.healthCheck();
  console.log(`\nInference provider: ${health.inference ? 'CONNECTED' : 'NOT AVAILABLE'}`);

  if (!health.inference) {
    console.log('\nNo inference provider detected!');
    console.log('Make sure your LLM provider is running:');
    console.log('  vLLM:       python -m vllm.entrypoints.openai.api_server --model <path>');
    console.log('  Ollama:     ollama pull qwen2.5:7b && ollama serve');
    console.log('  LM Studio:  Load a model and start the server\n');
    await engine.stop();
    return;
  }

  // --- Start the Engine ---
  // This begins the tick loop. Characters start making decisions.
  engine.start();
  console.log('Engine started! Characters are thinking...\n');

  // --- Inject a Game Event ---
  // Events are how your game tells characters about things happening.
  // Characters within perception range will react on their next tick.
  console.log('--- Injecting event: a merchant caravan arrives ---');
  await engine.injectEvent({
    type: 'world_event',
    source: 'game',
    data: { description: 'A merchant caravan arrives at the village with supplies to trade.' },
    importance: 6,  // 1-10 scale. Higher = more likely characters remember it.
    timestamp: Date.now(),
  });

  // --- Let It Run ---
  // In a real game, the engine runs alongside your game loop.
  // Here we just wait and watch the characters act.
  console.log('Watching for 20 seconds...\n');
  await new Promise(resolve => setTimeout(resolve, 20000));

  // --- Print Stats ---
  const stats = engine.getStats();
  console.log('\n--- Final Stats ---');
  console.log(`Decisions made: ${stats.inference.totalRequests}`);
  console.log(`Tokens used: ${stats.inference.totalTokens}`);
  console.log(`Fast ticks: ${stats.scheduler.fastTicks}`);
  console.log(`Characters: active=${stats.characters.active}, background=${stats.characters.background}, dormant=${stats.characters.dormant}`);

  console.log('\n--- Characters ---');
  for (const char of engine.getAllCharacters()) {
    const prox = engine.getCloseness(char.id);
    console.log(`  ${char.name} (${char.archetype}): closeness=${prox?.closeness.toFixed(1) ?? 0}, tier=${char.activityTier}`);
  }

  // --- Stop ---
  await engine.stop();
  console.log('\n=== Demo complete! ===');
  console.log('\nNext steps:');
  console.log('  1. Edit this file to change archetypes, tools, and characters');
  console.log('  2. Read QUICKSTART.md for a step-by-step tutorial');
  console.log('  3. Check out examples/sample-game/ for a more complete example');
}

main().catch(console.error);
