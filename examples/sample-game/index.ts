/**
 * Sample Game Plugin - "Tavern Tales"
 *
 * A simple tavern simulation demonstrating all engine features:
 * - Characters with different archetypes (barkeep, merchant, bard, guard)
 * - Tools: serve_drink, tell_story, trade_item, patrol
 * - Events: customer_arrives, bar_fight, song_request
 * - Dynamic closeness from interactions
 *
 * Usage:
 *   npx tsx examples/sample-game/index.ts
 */

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
  'barkeep': { location: 'behind the bar', action: 'polishing glasses', status: ['working'], inventory: ['towel', 'mug'] },
  'merchant': { location: 'corner table', action: 'reviewing ledger', status: ['busy'], inventory: ['ledger', 'coin purse', 'exotic spices'] },
  'bard': { location: 'stage area', action: 'tuning lute', status: ['relaxed'], inventory: ['lute', 'songbook'] },
  'guard': { location: 'near door', action: 'watching entrance', status: ['alert'], inventory: ['sword', 'shield', 'lantern'] },
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
          backstory: 'Former adventurer who settled down to run the Rusty Flagon tavern.',
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
          backstory: 'Travels the trade routes, stops at the Rusty Flagon regularly.',
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
          backstory: 'A traveling bard who found the Rusty Flagon has the best tales.',
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
          backstory: 'Local guard assigned to the tavern district after some trouble.',
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
          personality: 'Warm and welcoming but sharp-eyed. Keeps the peace with a firm hand and a kind word.',
          backstory: 'Former adventurer who retired after losing her party in the Darkwood. Now runs the Rusty Flagon.',
          goals: ['Keep the tavern profitable', 'Maintain order', 'Help those who remind her of her old friends'],
          traits: ['observant', 'patient', 'firm', 'generous', 'nostalgic'],
          speechStyle: 'Friendly but direct. Uses tavern metaphors. Calls everyone "dear" or "love".',
        },
        initialCloseness: 40,
      },
      {
        id: 'merchant',
        name: 'Fynn',
        archetype: 'merchant',
        identity: {
          personality: 'Shrewd and calculating but surprisingly fair. Respects a good negotiator.',
          backstory: 'Son of a merchant house that fell on hard times. Built himself back up through clever deals.',
          goals: ['Rebuild the family trade empire', 'Find the lost Silverwind cargo', 'Establish a permanent shop'],
          traits: ['cunning', 'charming', 'persistent', 'competitive'],
          speechStyle: 'Smooth talker. Always quantifying things. "That\'s a five-gold story if I ever heard one."',
        },
        initialCloseness: 15,
      },
      {
        id: 'bard',
        name: 'Elara',
        archetype: 'bard',
        identity: {
          personality: 'Charismatic and dramatic. Sees the world as one big story waiting to be told.',
          backstory: 'Ran away from a noble family to pursue music. Has a secret identity she protects.',
          goals: ['Write the greatest ballad ever composed', 'Find inspiration in real adventures', 'Keep her identity secret'],
          traits: ['creative', 'empathetic', 'dramatic', 'secretive'],
          speechStyle: 'Poetic and expressive. Quotes her own songs. Dramatic pauses.',
        },
        initialCloseness: 25,
      },
      {
        id: 'guard',
        name: 'Theron',
        archetype: 'guard',
        identity: {
          personality: 'Dutiful and stern on the outside, thoughtful and conflicted on the inside.',
          backstory: 'Transferred to the tavern district after questioning his captain\'s corruption.',
          goals: ['Uncover the corruption in the guard captain\'s ranks', 'Protect the innocent', 'Find allies he can trust'],
          traits: ['loyal', 'brave', 'suspicious', 'righteous'],
          speechStyle: 'Formal and measured. Speaks carefully, choosing words like they\'re evidence.',
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
            { name: 'drink', type: 'string', description: 'Type of drink', enum: ['ale', 'wine', 'water'], required: true },
            { name: 'target', type: 'string', description: 'Who to serve', required: true },
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
            { name: 'topic', type: 'string', description: 'What the story/song is about', required: true },
            { name: 'style', type: 'string', description: 'Performance style', enum: ['dramatic', 'funny', 'mysterious', 'heroic'], required: true },
          ],
          category: 'entertainment',
        },
        executor: (args) => {
          const effect = args.style === 'funny' ? 'lively' : args.style === 'mysterious' ? 'quiet' : 'lively';
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
            { name: 'area', type: 'string', description: 'Area to patrol', enum: ['entrance', 'bar', 'tables', 'back_room'], required: true },
          ],
          category: 'security',
        },
        executor: (args) => {
          const discoveries: Record<string, string> = {
            entrance: 'The entrance is clear. A cold draft blows in.',
            bar: 'Everything seems normal at the bar. Greta has things under control.',
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
            { name: 'target', type: 'string', description: 'What/who to observe', required: true },
          ],
          category: 'social',
        },
        executor: (args) => {
          const msg = `Observed ${args.target} carefully`;
          tavernState.recentEvents.push(msg);
          return { success: true, result: `You take a careful look at ${args.target}. They seem to be going about their business, but you notice small details others might miss.` };
        },
      },
    ];
  },

  getGameState(): GameState {
    return {
      worldTime: Date.now(),
      location: 'The Rusty Flagon Tavern',
      nearbyEntities: ['Greta (barkeep)', 'Fynn (merchant)', 'Elara (bard)', 'Theron (guard)', 'several patrons'],
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
    // Bar fights are important to guards, less so to merchants
    if (event.type === 'bar_fight') {
      if (characterId === 'guard') return 9;
      if (characterId === 'barkeep') return 8;
      return 5;
    }

    // Song requests are important to bards
    if (event.type === 'song_request' && characterId === 'bard') return 7;

    return undefined; // Use default scoring
  },

  getWorldRules(): string {
    return 'This is a medieval fantasy tavern. Characters should act accordingly. No modern technology exists. Gold is the currency.';
  },

  getEventTypes(): string[] {
    return ['customer_arrives', 'bar_fight', 'song_request', 'trade_offer', 'suspicious_activity', 'last_call'];
  },
};

// ============================================================
// Main - Run the sample game
// ============================================================

async function main() {
  console.log('=== Tavern Tales - AI Character Engine Demo ===\n');

  // Try loading config from file first, fall back to inline defaults
  let config: EngineConfig;
  try {
    config = loadConfigFile();
    console.log('Loaded config from engine.config.json\n');
  } catch {
    console.log('No engine.config.json found, using inline defaults\n');
    config = {
      database: { path: './data/tavern.db' },
      inference: {
        type: 'lmstudio',
        baseUrl: 'http://localhost:1234/v1',
        models: {
          heavy: 'your-model-name',
          mid: 'your-model-name',
          light: 'your-model-name',
        },
        maxConcurrency: 10,
        timeoutMs: 30000,
        maxRetries: 2,
      },
      proximity: {
        decayRatePerTick: 0.1,
        interactionBoost: 4,
        chatBoost: 2,
        promotionThreshold: 60,
        backgroundThreshold: 20,
        dormantThreshold: 5,
        chatMinCloseness: 40,
        delegateMinCloseness: 60,
        highWaterDecayMultiplier: 0.5,
      },
      tick: {
        fastTickMs: 5000,
        slowTickMs: 60000,
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
      logging: {
        level: 'info',
        pretty: true,
      },
    };
  }

  const engine = new Engine(config);

  // Load the tavern plugin
  await engine.loadPlugin(tavernPlugin);

  // Listen for events
  engine.events.on('agent:decision', (result) => {
    const action = 'toolName' in result.action
      ? `[TOOL] ${result.action.toolName}(${JSON.stringify(result.action.arguments)})`
      : result.action.type === 'dialogue'
        ? `[SAYS] "${(result.action as any).content}"`
        : '[IDLE]';
    console.log(`  ${result.characterId}: ${action} (${result.tokensUsed} tokens, ${result.durationMs}ms)`);
  });

  engine.events.on('proximity:tierChanged', (charId, oldTier, newTier) => {
    console.log(`  [TIER] ${charId}: ${oldTier} → ${newTier}`);
  });

  // Health check
  const health = await engine.healthCheck();
  console.log(`Inference provider: ${health.inference ? 'CONNECTED' : 'NOT AVAILABLE'}`);

  if (!health.inference) {
    console.log('\nLM Studio not running. Showing engine structure without inference.\n');
    showEngineState(engine);
    await engine.stop();
    return;
  }

  // Start the engine
  engine.start();
  console.log('Engine started! Characters are thinking...\n');

  // Simulate some interactions
  console.log('--- Boosting Greta\'s closeness to enable chat ---');
  engine.boostCloseness('barkeep', 25);

  // Try chatting with Greta (she starts at 40 + 25 = 65 closeness)
  try {
    console.log('\n--- Chatting with Greta ---');
    const response = await engine.chatWith('barkeep', 'What\'s the mood in the tavern tonight?');
    console.log(`Greta says: "${response.content}"\n`);
  } catch (err: any) {
    console.log(`Chat error: ${err.message}\n`);
  }

  // Inject some events
  console.log('--- Injecting events ---');
  await engine.injectEvent({
    type: 'customer_arrives',
    source: 'player',
    data: { name: 'A mysterious stranger in a dark cloak' },
    timestamp: Date.now(),
  });

  // Let the engine run for a bit
  console.log('Running for 15 seconds...\n');
  await new Promise(resolve => setTimeout(resolve, 15000));

  // Show final state
  showEngineState(engine);

  // Stop
  await engine.stop();
  console.log('\n=== Demo complete ===');
}

function showEngineState(engine: Engine) {
  const stats = engine.getStats();
  console.log('\n--- Engine Stats ---');
  console.log(`Characters: Active=${stats.characters.active}, Background=${stats.characters.background}, Dormant=${stats.characters.dormant}`);
  console.log(`Inference: ${stats.inference.totalRequests} requests, ${stats.inference.totalTokens} tokens`);
  console.log(`Scheduler: ${stats.scheduler.fastTicks} fast ticks, ${stats.scheduler.slowTicks} slow ticks`);

  console.log('\n--- Characters ---');
  for (const char of engine.getAllCharacters()) {
    const prox = engine.getCloseness(char.id);
    console.log(`  ${char.name} (${char.archetype}): closeness=${prox?.closeness.toFixed(1) ?? 0}, tier=${char.activityTier}`);
  }
}

main().catch(console.error);
