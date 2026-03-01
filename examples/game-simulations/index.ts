/**
 * Multi-Genre Game Simulations
 *
 * Tests the engine across 6 completely different game types to verify
 * it adapts to different contexts, tool sets, and world rules.
 *
 * Games:
 *   1. Pirate Crew       — Ship adventure, treasure, naval combat
 *   2. Space Station      — Sci-fi survival, repairs, research, defense
 *   3. Farm Village       — Peaceful life sim, farming, crafting, socializing
 *   4. Detective Agency   — Modern investigation, evidence, interrogation
 *   5. Survival Colony    — Post-apocalyptic resource management
 *   6. Wizard Academy     — Fantasy school, spells, potions, duels
 *
 * Usage:
 *   npx tsx examples/game-simulations/index.ts
 *   npx tsx examples/game-simulations/index.ts --chars=16 --ticks=10
 *   npx tsx examples/game-simulations/index.ts --game=pirate
 *   npx tsx examples/game-simulations/index.ts --game=all
 */

import { Engine, loadConfigFile } from '../../src/index';
import type {
  GamePlugin,
  ArchetypeDefinition,
  CharacterDefinition,
  ToolDefinition,
  GameState,
  CharacterProprioception,
  GameEvent,
  AgentDecisionResult,
  EngineConfig,
} from '../../src/index';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';

// ── CLI ─────────────────────────────────────────────────────

function getArg(name: string, defaultVal: string): string {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultVal;
}
function getNumArg(name: string, defaultVal: number): number {
  const v = getArg(name, String(defaultVal));
  return parseInt(v, 10);
}

const NUM_CHARS    = getNumArg('chars', 32);
const TARGET_TICKS = getNumArg('ticks', 10);
const FAST_MS      = getNumArg('fast-ms', 800);
const GAME_FILTER  = getArg('game', 'all');
const VLLM_PORT    = getNumArg('port', 8100);

// ── Shared helpers ──────────────────────────────────────────

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

interface SimMetrics {
  decisions: number;
  tokens: number;
  errors: number;
  tools: Record<string, number>;
  dialogue: number;
  idle: number;
  latencies: number[];
  events: number;
  ticks: number;
}

function freshMetrics(): SimMetrics {
  return { decisions: 0, tokens: 0, errors: 0, tools: {}, dialogue: 0, idle: 0, latencies: [], events: 0, ticks: 0 };
}

// ═══════════════════════════════════════════════════════════
// GAME 1: PIRATE CREW
// ═══════════════════════════════════════════════════════════

function createPiratePlugin(charCount: number): GamePlugin {
  const LOCATIONS = ['main_deck', 'crows_nest', 'cargo_hold', 'captains_cabin', 'port_tavern', 'shoreline', 'open_sea', 'enemy_ship'];
  const ARCHETYPES: Array<{ id: string; name: string; traits: string[]; goals: string[] }> = [
    { id: 'captain',    name: 'Captain',    traits: ['bold', 'decisive'],    goals: ['Find the lost treasure', 'Keep the crew loyal'] },
    { id: 'navigator',  name: 'Navigator',  traits: ['clever', 'observant'], goals: ['Chart unknown waters', 'Avoid the navy'] },
    { id: 'gunner',     name: 'Gunner',     traits: ['fierce', 'steady'],    goals: ['Sink enemy ships', 'Upgrade the cannons'] },
    { id: 'cook',       name: 'Cook',       traits: ['resourceful', 'jolly'],goals: ['Keep the crew fed', 'Find exotic spices'] },
    { id: 'surgeon',    name: 'Surgeon',    traits: ['calm', 'precise'],     goals: ['Heal wounded crew', 'Study sea creatures'] },
    { id: 'lookout',    name: 'Lookout',    traits: ['sharp-eyed', 'paranoid'], goals: ['Spot danger first', 'Map island coastlines'] },
    { id: 'quartermaster', name: 'Quartermaster', traits: ['fair', 'tough'],  goals: ['Divide loot evenly', 'Maintain discipline'] },
    { id: 'smuggler',   name: 'Smuggler',   traits: ['sly', 'charming'],     goals: ['Move contraband', 'Build contacts in every port'] },
  ];
  const NAMES = [
    'Blackjack', 'Red Mary', 'Iron Finn', 'Salty Pete', 'Storm Sarah', 'One-Eye Jack', 'Mad Greta', 'Silver Tom',
    'Cutlass Kate', 'Barnacle Bill', 'Tide Turner', 'Rum Rosie', 'Anchor Al', 'Coral Cass', 'Dagger Dan', 'Sea Wolf',
    'Misty Morgan', 'Cannon Cal', 'Reef Runner', 'Plank Pat', 'Wave Walker', 'Gold Gus', 'Shark Shade', 'Powder Pete',
    'Hook Helena', 'Compass Chris', 'Flint Faye', 'Rigging Rex', 'Harbor Hank', 'Sail Sam', 'Depths Diana', 'Thunder Theo',
  ];

  const charLocations = new Map<string, string>();
  const shipMorale = { value: 70 };

  const chars: CharacterDefinition[] = [];
  for (let i = 0; i < charCount; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const loc = LOCATIONS[i % LOCATIONS.length];
    charLocations.set(`pirate-${i}`, loc);
    chars.push({
      id: `pirate-${i}`,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}. Seasoned by years at sea.`,
        backstory: `Once a ${pick(['merchant', 'fisherman', 'navy deserter', 'orphan', 'noble'])}, turned pirate for ${pick(['freedom', 'revenge', 'gold', 'adventure'])}.`,
        goals: arch.goals,
        traits: arch.traits,
        speechStyle: `Talks like a salty pirate. Uses nautical terms.`,
      },
      initialCloseness: 40 + (i % 6) * 10,
    });
  }

  return {
    id: 'pirate-crew',
    name: 'Pirate Crew',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: `A ship's ${a.name.toLowerCase()}`,
      defaultIdentity: { personality: a.traits.join(', '), backstory: `A ${a.name.toLowerCase()}.`, goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: { name: 'sail_to', description: 'Sail the ship to a new area', parameters: [
            { name: 'destination', type: 'string', description: 'Where to sail', enum: LOCATIONS, required: true },
          ]},
          executor: (args) => ({ success: true, result: `Set sail for ${args.destination}. Wind is ${pick(['favorable', 'against us', 'calm'])}` }),
        },
        {
          definition: { name: 'board_enemy', description: 'Board and fight on an enemy vessel', parameters: [
            { name: 'approach', type: 'string', description: 'How to approach', enum: ['stealth', 'charge', 'flanking'], required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Boarded enemy ship with ${args.approach} approach. ${pick(['Fierce resistance!', 'Caught them off guard!', 'Heavy fighting!'])}`,
            sideEffects: [{ type: 'combat', source: 'agent', data: { approach: args.approach }, importance: 8, timestamp: Date.now() }],
          }),
        },
        {
          definition: { name: 'search_treasure', description: 'Search the area for treasure or useful items', parameters: [
            { name: 'area', type: 'string', description: 'Where to search', required: true },
          ]},
          executor: (args) => {
            const finds = ['a rusted compass', 'nothing but barnacles', 'a chest of doubloons!', 'a treasure map fragment', 'an old cutlass', 'exotic spices'];
            return { success: true, result: `Searched ${args.area}: found ${pick(finds)}` };
          },
        },
        {
          definition: { name: 'negotiate', description: 'Negotiate or parley with someone', parameters: [
            { name: 'target', type: 'string', description: 'Who to negotiate with', required: true },
            { name: 'offer', type: 'string', description: 'What you propose', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Negotiated with ${args.target}: ${pick(['deal struck', 'they refused', 'counter-offer made', 'tense standoff'])}`,
            sideEffects: [{ type: 'dialogue', source: 'agent', target: args.target as string, data: { offer: args.offer }, timestamp: Date.now() }],
          }),
        },
        {
          definition: { name: 'repair_ship', description: 'Repair damage to the ship', parameters: [
            { name: 'section', type: 'string', description: 'Which part to repair', enum: ['hull', 'sails', 'mast', 'rudder', 'cannons'], required: true },
          ]},
          executor: (args) => {
            shipMorale.value = Math.min(100, shipMorale.value + 5);
            return { success: true, result: `Repaired the ${args.section}. Ship is more seaworthy now.` };
          },
        },
        {
          definition: { name: 'fire_cannons', description: 'Fire the ship cannons at a target', parameters: [
            { name: 'target', type: 'string', description: 'What to fire at', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Cannons fired at ${args.target}! ${pick(['Direct hit!', 'Missed wide!', 'Glancing blow!', 'Devastating impact!'])}`,
            sideEffects: [{ type: 'combat', source: 'agent', data: { target: args.target, weapon: 'cannons' }, importance: 7, timestamp: Date.now() }],
          }),
        },
      ];
    },
    getGameState: () => ({
      worldTime: Date.now(), location: 'The Caribbean',
      nearbyEntities: chars.map(c => c.name),
      recentEvents: [`Ship morale: ${shipMorale.value}%`, `Weather: ${pick(['clear skies', 'storm brewing', 'fog rolling in', 'strong winds'])}`],
      custom: { morale: shipMorale.value, timePhase: pick(['dawn', 'midday', 'dusk', 'night']) },
    }),
    getProprioception: (id) => ({
      currentAction: 'on duty', location: charLocations.get(id) ?? 'main_deck',
      inventory: [pick(['cutlass', 'pistol', 'rope', 'spyglass', 'rum flask', 'compass'])],
      status: ['able-bodied'], energy: 0.6 + Math.random() * 0.4,
    }),
    getWorldRules: () => 'Pirate adventure on the high seas. You are a crew member on a pirate ship. Use your tools to sail, fight, explore, and survive. Be concise.',
    getEventTypes: () => ['combat', 'discovery', 'trade', 'dialogue', 'weather', 'mutiny'],
    filterEvent: () => true,
  };
}

// ═══════════════════════════════════════════════════════════
// GAME 2: SPACE STATION
// ═══════════════════════════════════════════════════════════

function createSpacePlugin(charCount: number): GamePlugin {
  const LOCATIONS = ['command_bridge', 'engineering', 'medbay', 'science_lab', 'cargo_bay', 'airlock', 'crew_quarters', 'reactor_room'];
  const ARCHETYPES: Array<{ id: string; name: string; traits: string[]; goals: string[] }> = [
    { id: 'commander', name: 'Commander', traits: ['authoritative', 'strategic'], goals: ['Keep the station operational', 'Protect the crew'] },
    { id: 'engineer',  name: 'Engineer',  traits: ['resourceful', 'methodical'], goals: ['Fix critical systems', 'Improve power efficiency'] },
    { id: 'medic',     name: 'Medic',     traits: ['empathetic', 'steady'],      goals: ['Treat injuries', 'Research disease cure'] },
    { id: 'scientist', name: 'Scientist', traits: ['curious', 'analytical'],     goals: ['Complete the experiment', 'Analyze alien samples'] },
    { id: 'pilot',     name: 'Pilot',     traits: ['daring', 'quick'],           goals: ['Navigate asteroid field', 'Scout nearby systems'] },
    { id: 'security',  name: 'Security',  traits: ['vigilant', 'disciplined'],   goals: ['Defend the station', 'Investigate anomalies'] },
    { id: 'comms',     name: 'Comms Officer', traits: ['perceptive', 'diplomatic'], goals: ['Maintain contact with Earth', 'Decode alien signals'] },
    { id: 'botanist',  name: 'Botanist',  traits: ['patient', 'nurturing'],      goals: ['Grow food for the crew', 'Cultivate alien plants'] },
  ];
  const NAMES = [
    'Chen', 'Vasquez', 'Okafor', 'Mueller', 'Tanaka', 'Jensen', 'Kowalski', 'Reyes',
    'Nkosi', 'Petrov', 'Singh', 'Williams', 'Larsson', 'Kim', 'Dubois', 'Nakamura',
    'Gonzalez', 'Patel', 'O\'Brien', 'Sato', 'Ahmed', 'Novak', 'Lee', 'Bergström',
    'Santos', 'Fischer', 'Johansson', 'Morales', 'Park', 'Weber', 'Ali', 'Takahashi',
  ];

  const charLocations = new Map<string, string>();
  const stationPower = { value: 85 };
  const hullIntegrity = { value: 92 };

  const chars: CharacterDefinition[] = [];
  for (let i = 0; i < charCount; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const loc = LOCATIONS[i % LOCATIONS.length];
    charLocations.set(`crew-${i}`, loc);
    chars.push({
      id: `crew-${i}`,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}. Professional and trained for deep space.`,
        backstory: `Selected from ${pick(['thousands of applicants', 'military service', 'academia', 'private sector'])} for the deep space mission.`,
        goals: arch.goals,
        traits: arch.traits,
        speechStyle: `Uses professional, technical language. Refers to ranks and protocols.`,
      },
      initialCloseness: 45 + (i % 5) * 10,
    });
  }

  return {
    id: 'space-station',
    name: 'Space Station Omega',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: `Station ${a.name.toLowerCase()}`,
      defaultIdentity: { personality: a.traits.join(', '), backstory: `A ${a.name.toLowerCase()}.`, goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: { name: 'repair_system', description: 'Repair a damaged station system', parameters: [
            { name: 'system', type: 'string', description: 'Which system', enum: ['life_support', 'shields', 'power_grid', 'comms_array', 'navigation', 'weapons'], required: true },
          ]},
          executor: (args) => {
            stationPower.value = Math.min(100, stationPower.value + 3);
            return { success: true, result: `Repaired ${args.system}. ${pick(['Nominal', 'Running at 80%', 'Fully restored', 'Patched but unstable'])}` };
          },
        },
        {
          definition: { name: 'scan_sector', description: 'Scan a nearby space sector for threats or resources', parameters: [
            { name: 'target', type: 'string', description: 'What to scan', enum: ['asteroid_belt', 'alien_vessel', 'nebula', 'debris_field', 'planet_surface', 'deep_space'], required: true },
          ]},
          executor: (args) => {
            const findings = ['nothing detected', 'mineral deposits found', 'unknown energy signature', 'hostile ship detected', 'distress signal', 'alien artifact'];
            return { success: true, result: `Scanning ${args.target}: ${pick(findings)}` };
          },
        },
        {
          definition: { name: 'treat_patient', description: 'Provide medical treatment to a crew member', parameters: [
            { name: 'patient', type: 'string', description: 'Who to treat', required: true },
            { name: 'treatment', type: 'string', description: 'Type of treatment', enum: ['first_aid', 'surgery', 'medication', 'quarantine'], required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Treated ${args.patient} with ${args.treatment}. ${pick(['Stable', 'Improving', 'Critical but alive', 'Full recovery'])}`,
          }),
        },
        {
          definition: { name: 'run_experiment', description: 'Conduct a scientific experiment', parameters: [
            { name: 'subject', type: 'string', description: 'What to study', required: true },
          ]},
          executor: (args) => {
            const results = ['inconclusive data', 'breakthrough discovery!', 'sample contaminated', 'confirming hypothesis', 'unexpected mutation'];
            return { success: true, result: `Experiment on ${args.subject}: ${pick(results)}` };
          },
        },
        {
          definition: { name: 'send_transmission', description: 'Send a communication or distress signal', parameters: [
            { name: 'recipient', type: 'string', description: 'Who to contact', required: true },
            { name: 'message', type: 'string', description: 'What to transmit', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Transmitted to ${args.recipient}: ${pick(['signal acknowledged', 'no response yet', 'interference detected', 'message received'])}`,
            sideEffects: [{ type: 'dialogue', source: 'agent', target: args.recipient as string, data: { message: args.message }, timestamp: Date.now() }],
          }),
        },
        {
          definition: { name: 'deploy_defense', description: 'Activate a defensive measure', parameters: [
            { name: 'defense', type: 'string', description: 'What defense to deploy', enum: ['shields', 'turrets', 'evasive_maneuver', 'countermeasures', 'lockdown'], required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Deployed ${args.defense}. ${pick(['Holding firm', 'Under strain', 'Fully active', 'Partially effective'])}`,
            sideEffects: [{ type: 'combat', source: 'agent', data: { defense: args.defense }, importance: 6, timestamp: Date.now() }],
          }),
        },
      ];
    },
    getGameState: () => ({
      worldTime: Date.now(), location: 'Station Omega - Deep Space',
      nearbyEntities: chars.map(c => c.name),
      recentEvents: [`Station power: ${stationPower.value}%`, `Hull integrity: ${hullIntegrity.value}%`],
      custom: { power: stationPower.value, hull: hullIntegrity.value, alert: pick(['green', 'yellow', 'red']) },
    }),
    getProprioception: (id) => ({
      currentAction: 'on shift', location: charLocations.get(id) ?? 'crew_quarters',
      inventory: [pick(['datapad', 'med_kit', 'tool_belt', 'scanner', 'sidearm'])],
      status: [pick(['healthy', 'fatigued', 'minor_injury'])], energy: 0.5 + Math.random() * 0.5,
    }),
    getWorldRules: () => 'Deep space survival on a space station. You are a crew member. Use your tools to repair, research, defend, and communicate. Be concise.',
    getEventTypes: () => ['combat', 'discovery', 'emergency', 'dialogue', 'system_failure', 'alien_contact'],
    filterEvent: () => true,
  };
}

// ═══════════════════════════════════════════════════════════
// GAME 3: FARM VILLAGE
// ═══════════════════════════════════════════════════════════

function createFarmPlugin(charCount: number): GamePlugin {
  const LOCATIONS = ['wheat_field', 'orchard', 'barn', 'market_square', 'bakery', 'river_bridge', 'windmill', 'village_hall'];
  const ARCHETYPES: Array<{ id: string; name: string; traits: string[]; goals: string[] }> = [
    { id: 'farmer',     name: 'Farmer',     traits: ['hardworking', 'steady'],     goals: ['Grow the best crops', 'Expand the farm'] },
    { id: 'baker',      name: 'Baker',      traits: ['warm', 'meticulous'],        goals: ['Bake for the whole village', 'Win the baking contest'] },
    { id: 'blacksmith', name: 'Blacksmith', traits: ['strong', 'creative'],        goals: ['Forge better tools', 'Master a new technique'] },
    { id: 'herbalist',  name: 'Herbalist',  traits: ['gentle', 'knowledgeable'],   goals: ['Grow a healing garden', 'Cure the village cough'] },
    { id: 'carpenter',  name: 'Carpenter',  traits: ['precise', 'patient'],        goals: ['Build a new barn', 'Repair the windmill'] },
    { id: 'shepherd',   name: 'Shepherd',   traits: ['quiet', 'observant'],        goals: ['Protect the flock', 'Find better grazing land'] },
    { id: 'innkeeper',  name: 'Innkeeper',  traits: ['hospitable', 'gossipy'],     goals: ['Fill every room', 'Hear all the news'] },
    { id: 'elder',      name: 'Village Elder', traits: ['wise', 'respected'],      goals: ['Keep peace in the village', 'Plan the harvest festival'] },
  ];
  const NAMES = [
    'Martha', 'Olaf', 'Rosie', 'Edwin', 'Clara', 'Bertram', 'Hazel', 'Wilfred',
    'Ivy', 'Cedric', 'Nell', 'Rufus', 'Winifred', 'Giles', 'Poppy', 'Albert',
    'Daisy', 'Ernest', 'Marigold', 'Percy', 'Violet', 'Harold', 'Blanche', 'Silas',
    'Mabel', 'Chester', 'Iris', 'Norman', 'Fern', 'Basil', 'Olive', 'Arthur',
  ];

  const charLocations = new Map<string, string>();
  const season = { current: 'spring' };

  const chars: CharacterDefinition[] = [];
  for (let i = 0; i < charCount; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const loc = LOCATIONS[i % LOCATIONS.length];
    charLocations.set(`villager-${i}`, loc);
    chars.push({
      id: `villager-${i}`,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}. Born and raised in the village.`,
        backstory: `${NAMES[i % NAMES.length]} has been the village ${arch.name.toLowerCase()} for ${5 + Math.floor(Math.random() * 20)} years.`,
        goals: arch.goals,
        traits: arch.traits,
        speechStyle: `Speaks warmly in a rural dialect. Mentions weather and crops often.`,
      },
      initialCloseness: 55 + (i % 4) * 10,
    });
  }

  return {
    id: 'farm-village',
    name: 'Willowbrook Village',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: `Village ${a.name.toLowerCase()}`,
      defaultIdentity: { personality: a.traits.join(', '), backstory: `A ${a.name.toLowerCase()}.`, goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: { name: 'tend_crops', description: 'Plant, water, or harvest crops in the fields', parameters: [
            { name: 'action', type: 'string', description: 'What to do', enum: ['plant', 'water', 'harvest', 'weed'], required: true },
            { name: 'crop', type: 'string', description: 'Which crop', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `${args.action}ed the ${args.crop}. ${pick(['Looking healthy!', 'Needs more rain.', 'Almost ready for harvest.', 'Pests spotted.'])}`,
          }),
        },
        {
          definition: { name: 'craft_item', description: 'Craft or build something useful', parameters: [
            { name: 'item', type: 'string', description: 'What to make', required: true },
            { name: 'material', type: 'string', description: 'Main material used', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Crafted a ${args.item} from ${args.material}. ${pick(['Fine quality!', 'Decent work.', 'Could be better.', 'Masterpiece!'])}`,
          }),
        },
        {
          definition: { name: 'trade_goods', description: 'Buy or sell goods at the market', parameters: [
            { name: 'action', type: 'string', description: 'Buy or sell', enum: ['buy', 'sell'], required: true },
            { name: 'item', type: 'string', description: 'What to trade', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `${args.action === 'buy' ? 'Bought' : 'Sold'} ${args.item}. ${pick(['Good price!', 'Fair deal.', 'Overpriced today.', 'Bargain!'])}`,
            sideEffects: [{ type: 'trade', source: 'agent', data: { action: args.action, item: args.item }, timestamp: Date.now() }],
          }),
        },
        {
          definition: { name: 'visit_neighbor', description: 'Visit a neighbor to chat, help, or share', parameters: [
            { name: 'neighbor', type: 'string', description: 'Who to visit', required: true },
            { name: 'purpose', type: 'string', description: 'Why visiting', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Visited ${args.neighbor}: ${pick(['Had a lovely chat.', 'Helped with chores.', 'Shared a meal.', 'Exchanged gossip.'])}`,
            sideEffects: [{ type: 'dialogue', source: 'agent', target: args.neighbor as string, data: { purpose: args.purpose }, timestamp: Date.now() }],
          }),
        },
        {
          definition: { name: 'forage', description: 'Gather wild herbs, berries, or materials from nature', parameters: [
            { name: 'location', type: 'string', description: 'Where to forage', enum: ['forest', 'riverbank', 'meadow', 'hillside'], required: true },
          ]},
          executor: (args) => {
            const finds = ['wild mushrooms', 'healing herbs', 'fresh berries', 'firewood', 'wild honey', 'nothing useful today'];
            return { success: true, result: `Foraged at ${args.location}: found ${pick(finds)}` };
          },
        },
        {
          definition: { name: 'cook_meal', description: 'Prepare a meal or baked goods', parameters: [
            { name: 'dish', type: 'string', description: 'What to cook', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Cooked ${args.dish}. ${pick(['Delicious!', 'Smells wonderful.', 'A bit burnt.', 'The best yet!'])}`,
          }),
        },
      ];
    },
    getGameState: () => ({
      worldTime: Date.now(), location: 'Willowbrook Village',
      nearbyEntities: chars.map(c => c.name),
      recentEvents: [`Season: ${season.current}`, `Weather: ${pick(['sunny', 'overcast', 'light rain', 'breezy'])}`],
      custom: { season: season.current, timePhase: pick(['early_morning', 'morning', 'afternoon', 'evening']), marketDay: Math.random() > 0.5 },
    }),
    getProprioception: (id) => ({
      currentAction: pick(['working', 'resting', 'walking']), location: charLocations.get(id) ?? 'village_hall',
      inventory: [pick(['seeds', 'bread', 'herbs', 'wool', 'tools', 'basket'])],
      status: ['healthy'], energy: 0.7 + Math.random() * 0.3,
    }),
    getWorldRules: () => 'Peaceful farming village life simulation. You are a villager. Use tools to farm, craft, trade, cook, forage, and visit neighbors. Be concise.',
    getEventTypes: () => ['trade', 'dialogue', 'festival', 'weather_change', 'harvest', 'visitor'],
    filterEvent: () => true,
  };
}

// ═══════════════════════════════════════════════════════════
// GAME 4: DETECTIVE AGENCY
// ═══════════════════════════════════════════════════════════

function createDetectivePlugin(charCount: number): GamePlugin {
  const LOCATIONS = ['precinct_hq', 'crime_scene', 'forensics_lab', 'interrogation_room', 'stakeout_van', 'courthouse', 'morgue', 'downtown_alley'];
  const ARCHETYPES: Array<{ id: string; name: string; traits: string[]; goals: string[] }> = [
    { id: 'lead_detective',   name: 'Lead Detective',   traits: ['intuitive', 'relentless'],    goals: ['Solve the case', 'Protect the team'] },
    { id: 'forensic_analyst', name: 'Forensic Analyst', traits: ['meticulous', 'analytical'],   goals: ['Process every piece of evidence', 'Build an airtight case'] },
    { id: 'undercover_agent', name: 'Undercover Agent', traits: ['adaptable', 'secretive'],     goals: ['Infiltrate the suspect network', 'Maintain cover'] },
    { id: 'beat_cop',         name: 'Beat Cop',         traits: ['dependable', 'streetwise'],   goals: ['Keep the neighborhood safe', 'Earn a promotion'] },
    { id: 'profiler',         name: 'Profiler',         traits: ['perceptive', 'cerebral'],     goals: ['Predict the suspect behavior', 'Build a psychological profile'] },
    { id: 'tech_specialist',  name: 'Tech Specialist',  traits: ['inventive', 'focused'],       goals: ['Crack encrypted devices', 'Trace digital footprints'] },
    { id: 'prosecutor',       name: 'Prosecutor',       traits: ['eloquent', 'determined'],     goals: ['Win the conviction', 'Ensure justice is served'] },
    { id: 'informant',        name: 'Informant',        traits: ['nervous', 'well-connected'],  goals: ['Stay alive', 'Feed useful tips to the agency'] },
  ];
  const NAMES = [
    'Reeves', 'Montoya', 'Bishop', 'Callahan', 'Ortiz', 'Shaw', 'Nakamura', 'Barrett',
    'Dixon', 'Vasquez', 'Thornton', 'Kim', 'Malone', 'Rivera', 'Gallagher', 'Chen',
    'Harper', 'DeLuca', 'Cross', 'Sterling', 'Park', 'Quinn', 'Wolfe', 'Santos',
    'Frost', 'Keane', 'Vega', 'Monroe', 'Blackwell', 'Torres', 'Reed', 'Doyle',
  ];

  const charLocations = new Map<string, string>();
  const caseProgress = { value: 15 };
  const suspicionLevel = { value: 30 };

  const chars: CharacterDefinition[] = [];
  for (let i = 0; i < charCount; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const loc = LOCATIONS[i % LOCATIONS.length];
    charLocations.set(`detective-${i}`, loc);
    chars.push({
      id: `detective-${i}`,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}. Years on the force have sharpened every instinct.`,
        backstory: `Joined the agency after ${pick(['a personal tragedy', 'military service', 'graduating top of the academy', 'years as a patrol officer'])}. Driven by ${pick(['justice', 'ambition', 'guilt', 'duty'])}.`,
        goals: arch.goals,
        traits: arch.traits,
        speechStyle: `Speaks in clipped, professional tones. Uses law-enforcement jargon.`,
      },
      initialCloseness: 35 + (i % 6) * 10,
    });
  }

  return {
    id: 'detective-agency',
    name: 'Metro Detective Agency',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: `Agency ${a.name.toLowerCase()}`,
      defaultIdentity: { personality: a.traits.join(', '), backstory: `A ${a.name.toLowerCase()}.`, goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: { name: 'interrogate', description: 'Question a suspect or witness about the case', parameters: [
            { name: 'target', type: 'string', description: 'Who to interrogate', required: true },
            { name: 'approach', type: 'string', description: 'Interrogation style', enum: ['friendly', 'aggressive', 'deceptive', 'silent_pressure'], required: true },
          ]},
          executor: (args) => {
            caseProgress.value = Math.min(100, caseProgress.value + 3);
            return {
              success: true, result: `Interrogated ${args.target} (${args.approach}): ${pick(['They cracked and gave a lead!', 'Refused to talk.', 'Story has inconsistencies.', 'Alibi checks out.', 'Demanded a lawyer.'])}`,
              sideEffects: [{ type: 'dialogue', source: 'agent', target: args.target as string, data: { approach: args.approach }, timestamp: Date.now() }],
            };
          },
        },
        {
          definition: { name: 'search_evidence', description: 'Search a location for physical evidence', parameters: [
            { name: 'location', type: 'string', description: 'Where to search', enum: ['crime_scene', 'suspect_home', 'vehicle', 'dumpster', 'office', 'warehouse'], required: true },
          ]},
          executor: (args) => {
            const finds = ['fingerprints on a door handle', 'a bloodstained cloth', 'shell casings', 'a burner phone', 'nothing usable', 'a torn receipt'];
            caseProgress.value = Math.min(100, caseProgress.value + 2);
            return { success: true, result: `Searched ${args.location}: found ${pick(finds)}` };
          },
        },
        {
          definition: { name: 'stake_out', description: 'Watch a location for suspect activity', parameters: [
            { name: 'target_location', type: 'string', description: 'Where to observe', required: true },
            { name: 'duration', type: 'string', description: 'How long to watch', enum: ['one_hour', 'half_day', 'overnight'], required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Staked out ${args.target_location} for ${args.duration}: ${pick(['Suspect arrived and met someone.', 'No activity.', 'Spotted suspicious vehicle.', 'Suspect left carrying a bag.', 'Got photos of an exchange.'])}`,
          }),
        },
        {
          definition: { name: 'analyze_clue', description: 'Run forensic analysis on a piece of evidence', parameters: [
            { name: 'evidence', type: 'string', description: 'What to analyze', required: true },
          ]},
          executor: (args) => {
            caseProgress.value = Math.min(100, caseProgress.value + 4);
            const results = ['DNA match found!', 'Partial prints — running through database.', 'Toxicology report pending.', 'Fibers match suspect wardrobe.', 'Inconclusive results.'];
            return { success: true, result: `Analyzed ${args.evidence}: ${pick(results)}` };
          },
        },
        {
          definition: { name: 'file_report', description: 'File a case report or update with headquarters', parameters: [
            { name: 'subject', type: 'string', description: 'What the report covers', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Filed report on ${args.subject}. ${pick(['Captain acknowledged.', 'Flagged for review.', 'Added to case file.', 'Forwarded to DA office.'])}`,
          }),
        },
        {
          definition: { name: 'arrest_suspect', description: 'Attempt to arrest a suspect', parameters: [
            { name: 'suspect', type: 'string', description: 'Who to arrest', required: true },
            { name: 'warrant', type: 'string', description: 'Type of authority', enum: ['with_warrant', 'probable_cause', 'in_pursuit'], required: true },
          ]},
          executor: (args) => {
            suspicionLevel.value = Math.max(0, suspicionLevel.value - 20);
            return {
              success: true, result: `Attempted arrest of ${args.suspect} (${args.warrant}): ${pick(['Suspect in custody!', 'Suspect fled the scene!', 'Resisted arrest — backup called.', 'Surrendered peacefully.'])}`,
              sideEffects: [{ type: 'arrest', source: 'agent', data: { suspect: args.suspect, warrant: args.warrant }, importance: 9, timestamp: Date.now() }],
            };
          },
        },
      ];
    },
    getGameState: () => ({
      worldTime: Date.now(), location: 'Metro City',
      nearbyEntities: chars.map(c => c.name),
      recentEvents: [`Case progress: ${caseProgress.value}%`, `Public suspicion level: ${suspicionLevel.value}%`],
      custom: { caseProgress: caseProgress.value, suspicionLevel: suspicionLevel.value, timePhase: pick(['dawn', 'morning', 'afternoon', 'evening', 'night']) },
    }),
    getProprioception: (id) => ({
      currentAction: pick(['investigating', 'on patrol', 'at desk']), location: charLocations.get(id) ?? 'precinct_hq',
      inventory: [pick(['badge', 'handcuffs', 'notepad', 'flashlight', 'radio', 'evidence_bag'])],
      status: [pick(['alert', 'tired', 'focused'])], energy: 0.5 + Math.random() * 0.5,
    }),
    getWorldRules: () => 'Modern detective agency in a city. You are an investigator. Use tools to interrogate, search for evidence, stake out, analyze clues, file reports, and arrest suspects. Be concise.',
    getEventTypes: () => ['crime_report', 'witness_testimony', 'evidence_found', 'suspect_sighting', 'internal_affairs'],
    filterEvent: () => true,
  };
}

// ═══════════════════════════════════════════════════════════
// GAME 5: SURVIVAL COLONY
// ═══════════════════════════════════════════════════════════

function createSurvivalPlugin(charCount: number): GamePlugin {
  const LOCATIONS = ['main_shelter', 'watchtower', 'supply_depot', 'med_tent', 'outer_wall', 'scrapyard', 'radio_shack', 'garden_plot'];
  const ARCHETYPES: Array<{ id: string; name: string; traits: string[]; goals: string[] }> = [
    { id: 'leader',         name: 'Leader',         traits: ['decisive', 'inspiring'],    goals: ['Keep the colony alive', 'Find a permanent safe zone'] },
    { id: 'medic',          name: 'Medic',          traits: ['compassionate', 'steady'],  goals: ['Treat the wounded', 'Stockpile medical supplies'] },
    { id: 'scout',          name: 'Scout',          traits: ['agile', 'cautious'],        goals: ['Map the surrounding area', 'Spot threats early'] },
    { id: 'engineer',       name: 'Engineer',       traits: ['resourceful', 'pragmatic'], goals: ['Reinforce defenses', 'Restore power to the colony'] },
    { id: 'scavenger',      name: 'Scavenger',      traits: ['bold', 'lucky'],            goals: ['Find food and supplies', 'Discover a cache of weapons'] },
    { id: 'guard',          name: 'Guard',          traits: ['vigilant', 'stoic'],        goals: ['Defend the perimeter', 'Train others to fight'] },
    { id: 'cook',           name: 'Cook',           traits: ['creative', 'frugal'],       goals: ['Stretch rations further', 'Boost morale with a good meal'] },
    { id: 'radio_operator', name: 'Radio Operator', traits: ['patient', 'hopeful'],       goals: ['Contact other survivors', 'Intercept enemy transmissions'] },
  ];
  const NAMES = [
    'Dawson', 'Reyes', 'Murphy', 'Tran', 'Kowalski', 'Okafor', 'Jensen', 'Silva',
    'Brooks', 'Hassan', 'Nguyen', 'Price', 'Volkov', 'Duarte', 'Erikson', 'Cho',
    'Fletcher', 'Ramirez', 'Stone', 'Patel', 'Ivanov', 'Cruz', 'Wagner', 'Yusuf',
    'Collins', 'Tanaka', 'Marsh', 'Abbas', 'Larsen', 'Ortega', 'Hunt', 'Kato',
  ];

  const charLocations = new Map<string, string>();
  const supplies = { food: 60, water: 55, medical: 40, ammo: 30 };
  const wallIntegrity = { value: 70 };
  const threatLevel = { value: 45 };

  const chars: CharacterDefinition[] = [];
  for (let i = 0; i < charCount; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const loc = LOCATIONS[i % LOCATIONS.length];
    charLocations.set(`survivor-${i}`, loc);
    chars.push({
      id: `survivor-${i}`,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}. Hardened by months of survival.`,
        backstory: `Before the collapse, was a ${pick(['teacher', 'mechanic', 'nurse', 'soldier', 'office worker', 'farmer'])}. Found the colony ${pick(['by luck', 'following a radio signal', 'after weeks alone', 'with a small group'])}.`,
        goals: arch.goals,
        traits: arch.traits,
        speechStyle: `Speaks in terse, practical sentences. Wastes no words.`,
      },
      initialCloseness: 40 + (i % 5) * 10,
    });
  }

  return {
    id: 'survival-colony',
    name: 'Colony Outpost',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: `Colony ${a.name.toLowerCase()}`,
      defaultIdentity: { personality: a.traits.join(', '), backstory: `A ${a.name.toLowerCase()}.`, goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: { name: 'scavenge', description: 'Search an area for food, water, or useful supplies', parameters: [
            { name: 'area', type: 'string', description: 'Where to scavenge', enum: ['abandoned_store', 'wrecked_vehicles', 'collapsed_building', 'underground_bunker', 'overgrown_suburb', 'industrial_zone'], required: true },
          ]},
          executor: (args) => {
            const loot = pick(['canned food', 'bottled water', 'bandages', 'ammo box', 'nothing useful', 'fuel canister', 'a rusty knife']);
            if (loot === 'canned food') supplies.food = Math.min(100, supplies.food + 5);
            if (loot === 'bottled water') supplies.water = Math.min(100, supplies.water + 5);
            if (loot === 'bandages') supplies.medical = Math.min(100, supplies.medical + 3);
            if (loot === 'ammo box') supplies.ammo = Math.min(100, supplies.ammo + 5);
            return { success: true, result: `Scavenged ${args.area}: found ${loot}` };
          },
        },
        {
          definition: { name: 'fortify', description: 'Reinforce a section of the colony defenses', parameters: [
            { name: 'section', type: 'string', description: 'What to fortify', enum: ['north_wall', 'south_gate', 'watchtower', 'main_entrance', 'perimeter_fence'], required: true },
          ]},
          executor: (args) => {
            wallIntegrity.value = Math.min(100, wallIntegrity.value + 5);
            return { success: true, result: `Fortified ${args.section}. ${pick(['Holding strong.', 'Patched with scrap metal.', 'Added barbed wire.', 'Reinforced with concrete.'])}` };
          },
        },
        {
          definition: { name: 'scout_perimeter', description: 'Scout the surrounding area for threats or resources', parameters: [
            { name: 'direction', type: 'string', description: 'Which direction to scout', enum: ['north', 'south', 'east', 'west'], required: true },
          ]},
          executor: (args) => {
            const findings = ['hostile group spotted 2 miles out', 'all clear', 'abandoned vehicle with supplies', 'animal tracks — possible food', 'smoke on the horizon', 'another survivor group'];
            return { success: true, result: `Scouted ${args.direction}: ${pick(findings)}` };
          },
        },
        {
          definition: { name: 'treat_wound', description: 'Provide medical treatment to an injured survivor', parameters: [
            { name: 'patient', type: 'string', description: 'Who to treat', required: true },
            { name: 'treatment', type: 'string', description: 'Type of treatment', enum: ['bandage', 'splint', 'antibiotics', 'surgery'], required: true },
          ]},
          executor: (args) => {
            supplies.medical = Math.max(0, supplies.medical - 3);
            return {
              success: true, result: `Treated ${args.patient} with ${args.treatment}. ${pick(['Stable now.', 'Needs rest.', 'Critical but alive.', 'Full recovery expected.'])}`,
            };
          },
        },
        {
          definition: { name: 'ration_supplies', description: 'Manage colony supply distribution', parameters: [
            { name: 'resource', type: 'string', description: 'Which resource', enum: ['food', 'water', 'medical', 'ammo'], required: true },
            { name: 'action', type: 'string', description: 'How to manage', enum: ['distribute', 'stockpile', 'trade', 'ration'], required: true },
          ]},
          executor: (args) => ({
            success: true, result: `${args.action}d ${args.resource} supplies. ${pick(['People are grateful.', 'Some complaints.', 'Reserves adjusted.', 'Morale boosted slightly.'])}`,
          }),
        },
        {
          definition: { name: 'signal_for_help', description: 'Broadcast a radio signal to find other survivors', parameters: [
            { name: 'frequency', type: 'string', description: 'Which frequency band', enum: ['emergency', 'military', 'civilian', 'shortwave'], required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Broadcast on ${args.frequency} frequency: ${pick(['Static only.', 'Faint voice — coordinates received!', 'Hostile response — they know our location.', 'Friendly group replied!', 'No response.'])}`,
            sideEffects: [{ type: 'transmission', source: 'agent', data: { frequency: args.frequency }, importance: 6, timestamp: Date.now() }],
          }),
        },
      ];
    },
    getGameState: () => ({
      worldTime: Date.now(), location: 'Colony Outpost — Sector 7',
      nearbyEntities: chars.map(c => c.name),
      recentEvents: [
        `Supplies — Food: ${supplies.food}%, Water: ${supplies.water}%, Medical: ${supplies.medical}%, Ammo: ${supplies.ammo}%`,
        `Wall integrity: ${wallIntegrity.value}%  |  Threat level: ${threatLevel.value}%`,
      ],
      custom: { supplies, wallIntegrity: wallIntegrity.value, threatLevel: threatLevel.value, timePhase: pick(['dawn', 'midday', 'dusk', 'night']) },
    }),
    getProprioception: (id) => ({
      currentAction: pick(['on watch', 'resting', 'working']), location: charLocations.get(id) ?? 'main_shelter',
      inventory: [pick(['makeshift_weapon', 'canteen', 'bandage', 'binoculars', 'walkie_talkie', 'ration_pack'])],
      status: [pick(['hungry', 'alert', 'exhausted', 'healthy'])], energy: 0.4 + Math.random() * 0.5,
    }),
    getWorldRules: () => 'Post-apocalyptic survival colony. You are a survivor. Use tools to scavenge, fortify, scout, treat wounds, ration supplies, and signal for help. Resources are scarce. Be concise.',
    getEventTypes: () => ['threat_detected', 'supply_shortage', 'injury', 'transmission_received', 'weather_hazard'],
    filterEvent: () => true,
  };
}

// ═══════════════════════════════════════════════════════════
// GAME 6: WIZARD ACADEMY
// ═══════════════════════════════════════════════════════════

function createAcademyPlugin(charCount: number): GamePlugin {
  const LOCATIONS = ['great_hall', 'potions_classroom', 'library_tower', 'dueling_arena', 'herbology_garden', 'dormitory', 'headmasters_office', 'enchanted_courtyard'];
  const ARCHETYPES: Array<{ id: string; name: string; traits: string[]; goals: string[] }> = [
    { id: 'prodigy',           name: 'Prodigy',           traits: ['gifted', 'ambitious'],     goals: ['Master advanced magic', 'Win the annual tournament'] },
    { id: 'herbalist_student', name: 'Herbalist Student', traits: ['gentle', 'patient'],       goals: ['Grow a perfect moonbloom', 'Pass the herbology exam'] },
    { id: 'professor',         name: 'Professor',         traits: ['wise', 'stern'],           goals: ['Teach the next generation', 'Research forbidden spells'] },
    { id: 'troublemaker',      name: 'Troublemaker',      traits: ['mischievous', 'clever'],   goals: ['Pull off the ultimate prank', 'Discover secret passages'] },
    { id: 'librarian',         name: 'Librarian',         traits: ['bookish', 'protective'],   goals: ['Catalog every tome', 'Guard the restricted section'] },
    { id: 'duelist',           name: 'Duelist',           traits: ['competitive', 'quick'],    goals: ['Become the top-ranked dueler', 'Learn a rare combat spell'] },
    { id: 'prefect',           name: 'Prefect',           traits: ['responsible', 'fair'],     goals: ['Maintain order', 'Set a good example for younger students'] },
    { id: 'exchange_student',  name: 'Exchange Student',  traits: ['curious', 'adaptable'],    goals: ['Learn this school\'s traditions', 'Share foreign magic'] },
  ];
  const NAMES = [
    'Elara', 'Theron', 'Ivy', 'Cedric', 'Luna', 'Rowan', 'Seraphina', 'Felix',
    'Briar', 'Magnus', 'Wren', 'Alaric', 'Dahlia', 'Orion', 'Sage', 'Cassius',
    'Neve', 'Leander', 'Clover', 'Jasper', 'Lyra', 'Emeric', 'Hazel', 'Dorian',
    'Freya', 'Stellan', 'Maeve', 'Florian', 'Aurora', 'Sirius', 'Isolde', 'Bastian',
  ];

  const charLocations = new Map<string, string>();
  const academyMorale = { value: 75 };
  const currentClass = { value: 'potions' };

  const chars: CharacterDefinition[] = [];
  for (let i = 0; i < charCount; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const loc = LOCATIONS[i % LOCATIONS.length];
    charLocations.set(`wizard-${i}`, loc);
    chars.push({
      id: `wizard-${i}`,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}. Lives and breathes magic.`,
        backstory: `${pick(['Discovered magical talent at age 7', 'Comes from a long line of wizards', 'Was a late bloomer with sudden power', 'Arrived from a distant magical academy'])}. Specializes in ${pick(['elemental magic', 'illusions', 'enchantments', 'divination', 'transmutation'])}.`,
        goals: arch.goals,
        traits: arch.traits,
        speechStyle: `Speaks with wonder about magic. Uses arcane terminology casually.`,
      },
      initialCloseness: 45 + (i % 5) * 10,
    });
  }

  return {
    id: 'wizard-academy',
    name: 'Arcanum Academy',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: `Academy ${a.name.toLowerCase()}`,
      defaultIdentity: { personality: a.traits.join(', '), backstory: `A ${a.name.toLowerCase()}.`, goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: { name: 'study_spell', description: 'Practice or learn a magical spell', parameters: [
            { name: 'spell', type: 'string', description: 'Which spell to study', required: true },
            { name: 'intensity', type: 'string', description: 'Study intensity', enum: ['casual', 'focused', 'intensive'], required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Studied ${args.spell} (${args.intensity}): ${pick(['Made progress!', 'Accidental explosion — singed eyebrows.', 'Almost got it right.', 'Breakthrough moment!', 'Fizzled out completely.'])}`,
          }),
        },
        {
          definition: { name: 'brew_potion', description: 'Brew a magical potion in the lab', parameters: [
            { name: 'potion', type: 'string', description: 'Which potion to brew', required: true },
            { name: 'ingredient', type: 'string', description: 'Key ingredient used', required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Brewed ${args.potion} with ${args.ingredient}: ${pick(['Perfect brew!', 'Turned an odd color.', 'Cauldron overflowed!', 'Smells right.', 'Volatile — handle with care.'])}`,
          }),
        },
        {
          definition: { name: 'attend_class', description: 'Attend a scheduled academy class', parameters: [
            { name: 'subject', type: 'string', description: 'Which class', enum: ['potions', 'charms', 'defense', 'herbology', 'divination', 'history_of_magic'], required: true },
          ]},
          executor: (args) => {
            currentClass.value = args.subject as string;
            return { success: true, result: `Attended ${args.subject} class: ${pick(['Learned something new.', 'Got called on and answered well.', 'Nearly fell asleep.', 'Teacher gave bonus points!', 'Pop quiz — barely passed.'])}` };
          },
        },
        {
          definition: { name: 'duel_practice', description: 'Practice magical combat in the arena', parameters: [
            { name: 'opponent', type: 'string', description: 'Who to duel', required: true },
            { name: 'strategy', type: 'string', description: 'Dueling approach', enum: ['aggressive', 'defensive', 'trick_spell', 'counter_attack'], required: true },
          ]},
          executor: (args) => ({
            success: true, result: `Dueled ${args.opponent} (${args.strategy}): ${pick(['Won decisively!', 'Lost after a close fight.', 'Draw — both exhausted.', 'Opponent yielded.', 'Spell backfired!'])}`,
            sideEffects: [{ type: 'duel', source: 'agent', target: args.opponent as string, data: { strategy: args.strategy }, importance: 5, timestamp: Date.now() }],
          }),
        },
        {
          definition: { name: 'explore_library', description: 'Search the library for rare knowledge or hidden texts', parameters: [
            { name: 'section', type: 'string', description: 'Which section to explore', required: true },
          ]},
          executor: (args) => {
            const finds = ['an ancient scroll', 'a book that whispers', 'nothing unusual', 'a hidden compartment', 'a map of secret tunnels', 'a forbidden grimoire'];
            return { success: true, result: `Explored library ${args.section}: found ${pick(finds)}` };
          },
        },
        {
          definition: { name: 'gossip', description: 'Share or gather rumors around the academy', parameters: [
            { name: 'topic', type: 'string', description: 'What to gossip about', required: true },
          ]},
          executor: (args) => {
            academyMorale.value = Math.min(100, academyMorale.value + 1);
            return {
              success: true, result: `Gossiped about ${args.topic}: ${pick(['Juicy rumor confirmed!', 'Nobody knows anything.', 'Started a wild new rumor.', 'Heard something interesting.', 'Got conflicting stories.'])}`,
              sideEffects: [{ type: 'social', source: 'agent', data: { topic: args.topic }, timestamp: Date.now() }],
            };
          },
        },
      ];
    },
    getGameState: () => ({
      worldTime: Date.now(), location: 'Arcanum Academy',
      nearbyEntities: chars.map(c => c.name),
      recentEvents: [`Academy morale: ${academyMorale.value}%`, `Current class: ${currentClass.value}`],
      custom: { academyMorale: academyMorale.value, currentClass: currentClass.value, timePhase: pick(['breakfast', 'morning_classes', 'lunch', 'afternoon_classes', 'free_period', 'curfew']) },
    }),
    getProprioception: (id) => ({
      currentAction: pick(['studying', 'wandering', 'in class']), location: charLocations.get(id) ?? 'great_hall',
      inventory: [pick(['wand', 'spellbook', 'potion_vial', 'quill', 'crystal', 'familiar_treat'])],
      status: [pick(['energized', 'tired', 'inspired'])], energy: 0.5 + Math.random() * 0.5,
    }),
    getWorldRules: () => 'Magical academy for young wizards. You are a member of the academy. Use tools to study spells, brew potions, attend class, duel, explore the library, and gossip. Be concise.',
    getEventTypes: () => ['class_announcement', 'potion_accident', 'forbidden_magic', 'duel_challenge', 'social_event'],
    filterEvent: () => true,
  };
}

// ═══════════════════════════════════════════════════════════
// SIMULATION RUNNER
// ═══════════════════════════════════════════════════════════

interface GameDef {
  name: string;
  emoji: string;
  createPlugin: (chars: number) => GamePlugin;
  events: GameEvent[];
}

const GAMES: GameDef[] = [
  {
    name: 'Pirate Crew',
    emoji: '🏴‍☠️',
    createPlugin: createPiratePlugin,
    events: [
      { type: 'combat', source: 'navy_patrol', data: { description: 'Navy ships spotted on the horizon!' }, importance: 8, timestamp: 0 },
      { type: 'discovery', source: 'lookout', data: { description: 'An uncharted island with a lighthouse!' }, importance: 6, timestamp: 0 },
      { type: 'weather', source: 'nature', data: { description: 'A violent storm is approaching fast!' }, importance: 7, timestamp: 0 },
      { type: 'mutiny', source: 'disgruntled_crew', data: { description: 'Whispers of mutiny below decks...' }, importance: 9, timestamp: 0 },
      { type: 'trade', source: 'merchant_ship', data: { description: 'A merchant vessel signals for parley.' }, importance: 5, timestamp: 0 },
    ],
  },
  {
    name: 'Space Station',
    emoji: '🚀',
    createPlugin: createSpacePlugin,
    events: [
      { type: 'emergency', source: 'station_AI', data: { description: 'Hull breach in sector 7! Atmosphere venting!' }, importance: 9, timestamp: 0 },
      { type: 'alien_contact', source: 'deep_space', data: { description: 'Unknown alien vessel approaching. Intentions unclear.' }, importance: 8, timestamp: 0 },
      { type: 'system_failure', source: 'engineering', data: { description: 'Power grid fluctuations detected. Reactor unstable.' }, importance: 7, timestamp: 0 },
      { type: 'discovery', source: 'science_lab', data: { description: 'The alien samples are showing signs of life!' }, importance: 6, timestamp: 0 },
      { type: 'dialogue', source: 'earth_command', data: { description: 'Incoming transmission from Earth Command: mission update.' }, importance: 5, timestamp: 0 },
    ],
  },
  {
    name: 'Farm Village',
    emoji: '🌾',
    createPlugin: createFarmPlugin,
    events: [
      { type: 'festival', source: 'village_council', data: { description: 'The harvest festival begins! Everyone to the village square!' }, importance: 6, timestamp: 0 },
      { type: 'weather_change', source: 'nature', data: { description: 'Heavy rains are flooding the lower fields!' }, importance: 7, timestamp: 0 },
      { type: 'visitor', source: 'road', data: { description: 'A traveling merchant arrives with exotic goods!' }, importance: 5, timestamp: 0 },
      { type: 'harvest', source: 'fields', data: { description: 'The wheat is golden and ready for harvest!' }, importance: 6, timestamp: 0 },
      { type: 'dialogue', source: 'elder', data: { description: 'The elder calls a meeting about the well running dry.' }, importance: 7, timestamp: 0 },
    ],
  },
  {
    name: 'Detective Agency',
    emoji: '🔍',
    createPlugin: createDetectivePlugin,
    events: [
      { type: 'crime_report', source: 'dispatch', data: { description: 'New homicide reported downtown. All units respond.' }, importance: 9, timestamp: 0 },
      { type: 'witness_testimony', source: 'witness', data: { description: 'A witness just came forward with new information about the suspect.' }, importance: 7, timestamp: 0 },
      { type: 'evidence_found', source: 'forensics', data: { description: 'Lab results are back — DNA match on the murder weapon.' }, importance: 8, timestamp: 0 },
      { type: 'suspect_sighting', source: 'patrol', data: { description: 'Suspect spotted near the train station. Looks like they are fleeing.' }, importance: 8, timestamp: 0 },
      { type: 'internal_affairs', source: 'IA_division', data: { description: 'Internal affairs is reviewing the case. Watch your procedures.' }, importance: 6, timestamp: 0 },
    ],
  },
  {
    name: 'Survival Colony',
    emoji: '☢️',
    createPlugin: createSurvivalPlugin,
    events: [
      { type: 'threat_detected', source: 'watchtower', data: { description: 'Hostile group approaching from the north! Armed and dangerous.' }, importance: 9, timestamp: 0 },
      { type: 'supply_shortage', source: 'quartermaster', data: { description: 'Water reserves critically low. Two days left at current consumption.' }, importance: 8, timestamp: 0 },
      { type: 'injury', source: 'outer_wall', data: { description: 'Guard injured during a scuffle at the perimeter. Needs medical attention.' }, importance: 7, timestamp: 0 },
      { type: 'transmission_received', source: 'radio_shack', data: { description: 'Faint radio signal received: another colony 50 miles east requesting aid.' }, importance: 6, timestamp: 0 },
      { type: 'weather_hazard', source: 'nature', data: { description: 'Toxic dust storm rolling in. Seal all shelters immediately.' }, importance: 8, timestamp: 0 },
    ],
  },
  {
    name: 'Wizard Academy',
    emoji: '🧙',
    createPlugin: createAcademyPlugin,
    events: [
      { type: 'class_announcement', source: 'headmaster', data: { description: 'Surprise exam in Defense Against Dark Arts tomorrow!' }, importance: 6, timestamp: 0 },
      { type: 'potion_accident', source: 'potions_classroom', data: { description: 'A cauldron exploded in the potions lab! Purple smoke everywhere!' }, importance: 7, timestamp: 0 },
      { type: 'forbidden_magic', source: 'library_tower', data: { description: 'Someone used forbidden magic in the restricted section. The wards are triggered.' }, importance: 8, timestamp: 0 },
      { type: 'duel_challenge', source: 'dueling_arena', data: { description: 'A senior student has challenged all comers to a duel for house honor!' }, importance: 6, timestamp: 0 },
      { type: 'social_event', source: 'great_hall', data: { description: 'The annual Moonlight Ball is tonight! Everyone is invited.' }, importance: 5, timestamp: 0 },
    ],
  },
];

async function runSimulation(game: GameDef): Promise<{ metrics: SimMetrics; durationSec: number }> {
  const m = freshMetrics();

  // Try config file first, fall back to vLLM auto-detect
  let config: EngineConfig;
  try {
    config = loadConfigFile();
    // Override with CLI args
    config.database = { path: ':memory:' };
    config.tick = { fastTickMs: FAST_MS, slowTickMs: FAST_MS * 10, batchSize: NUM_CHARS };
    config.logging = { level: 'error' };
  } catch {
    // Auto-detect model name from vLLM
    let modelName = 'default';
    try {
      const resp = await fetch(`http://127.0.0.1:${VLLM_PORT}/v1/models`);
      const data = await resp.json() as { data: Array<{ id: string }> };
      if (data.data?.[0]?.id) modelName = data.data[0].id;
    } catch {}

    config = {
      database: { path: ':memory:' },
      inference: {
        type: 'vllm',
        baseUrl: `http://127.0.0.1:${VLLM_PORT}/v1`,
        models: { heavy: modelName, mid: modelName, light: modelName },
        maxConcurrency: 64,
        timeoutMs: 60000,
      },
      tick: { fastTickMs: FAST_MS, slowTickMs: FAST_MS * 10, batchSize: NUM_CHARS },
      logging: { level: 'error' },
    };
  }

  const engine = new Engine(config);

  // Collect metrics
  engine.events.on('agent:decision', (result: AgentDecisionResult) => {
    m.decisions++;
    m.tokens += result.tokensUsed;
    m.latencies.push(result.durationMs);
    if ('toolName' in result.action) {
      const name = (result.action as any).toolName;
      m.tools[name] = (m.tools[name] ?? 0) + 1;
    } else if (result.action.type === 'dialogue') {
      m.dialogue++;
    } else {
      m.idle++;
    }
  });
  engine.events.on('agent:error', () => { m.errors++; });
  engine.events.on('tick:fast', () => { m.ticks++; });

  await engine.loadPlugin(game.createPlugin(NUM_CHARS));
  const start = Date.now();
  engine.start();

  // Inject game-specific events across the simulation
  const eventInterval = setInterval(async () => {
    const ev = { ...pick(game.events), timestamp: Date.now() };
    m.events++;
    try { await engine.injectEvent(ev); } catch {}
  }, 3000);

  // Wait for target ticks
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (m.ticks >= TARGET_TICKS) { clearInterval(check); resolve(); }
    }, 200);
  });

  clearInterval(eventInterval);
  const durationSec = (Date.now() - start) / 1000;

  // Capture health before stopping
  const health = await engine.healthCheck();
  await engine.stop();

  if (!health.database) {
    console.log('  WARNING: Database unhealthy at end of simulation');
  }

  return { metrics: m, durationSec };
}

// ── Pretty printing ─────────────────────────────────────────

function printHeader(text: string) {
  const line = '═'.repeat(58);
  console.log(`\n╔${line}╗`);
  console.log(`║  ${text.padEnd(56)}║`);
  console.log(`╚${line}╝`);
}

function printGameResult(game: GameDef, m: SimMetrics, dur: number) {
  const line = '─'.repeat(56);
  const totalActions = m.decisions || 1;
  const toolTotal = Object.values(m.tools).reduce((a, b) => a + b, 0);
  const throughput = (m.decisions / dur).toFixed(2);
  const p50 = percentile(m.latencies, 50);
  const p95 = percentile(m.latencies, 95);

  console.log(`\n  ${game.emoji} ${game.name}`);
  console.log(`  ${line}`);
  console.log(`  Decisions: ${m.decisions}  |  Throughput: ${throughput}/s  |  Errors: ${m.errors}`);
  console.log(`  Tokens: ${m.tokens.toLocaleString()}  |  p50: ${p50.toFixed(0)}ms  |  p95: ${p95.toFixed(0)}ms`);
  console.log(`  Events injected: ${m.events}  |  Ticks: ${m.ticks}  |  Duration: ${dur.toFixed(1)}s`);
  console.log(`  ${line}`);

  // Tool distribution — sorted by usage
  const sorted = Object.entries(m.tools).sort((a, b) => b[1] - a[1]);
  const maxBar = 30;
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;

  console.log('  Tool Distribution:');
  for (const [name, count] of sorted) {
    const pct = ((count / totalActions) * 100).toFixed(1);
    const barLen = Math.max(1, Math.round((count / maxCount) * maxBar));
    const bar = '█'.repeat(barLen);
    console.log(`    ${name.padEnd(18)} ${bar} ${count} (${pct}%)`);
  }
  console.log(`    ${'dialogue'.padEnd(18)} ${'░'.repeat(Math.max(1, Math.round((m.dialogue / maxCount) * maxBar)))} ${m.dialogue} (${((m.dialogue / totalActions) * 100).toFixed(1)}%)`);
  if (m.idle > 0) {
    console.log(`    ${'idle'.padEnd(18)} ${'░'.repeat(Math.max(1, Math.round((m.idle / maxCount) * maxBar)))} ${m.idle} (${((m.idle / totalActions) * 100).toFixed(1)}%)`);
  }

  // Balance score: Gini coefficient inverted (1 = perfectly balanced)
  const toolCounts = Object.values(m.tools);
  if (toolCounts.length > 1) {
    const mean = toolCounts.reduce((a, b) => a + b, 0) / toolCounts.length;
    let giniSum = 0;
    for (const a of toolCounts) {
      for (const b of toolCounts) {
        giniSum += Math.abs(a - b);
      }
    }
    const gini = giniSum / (2 * toolCounts.length * toolCounts.length * mean);
    const balance = ((1 - gini) * 100).toFixed(0);
    console.log(`\n  Tool Balance Score: ${balance}% (100% = perfectly even, Gini=${gini.toFixed(3)})`);
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        AI Character Engine — Game Simulations           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Characters per game: ${NUM_CHARS}`);
  console.log(`  Target ticks: ${TARGET_TICKS}`);
  console.log(`  vLLM port: ${VLLM_PORT}`);

  // Health check
  try {
    const baseUrl = `http://127.0.0.1:${VLLM_PORT}`;
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('unhealthy');
    console.log(`  vLLM: connected\n`);
  } catch {
    console.log(`\n  ERROR: vLLM not available at port ${VLLM_PORT}. Start vLLM first.`);
    process.exit(1);
  }

  const gamesToRun = GAME_FILTER === 'all'
    ? GAMES
    : GAMES.filter(g => g.name.toLowerCase().includes(GAME_FILTER.toLowerCase()));

  if (gamesToRun.length === 0) {
    console.log(`  No games matching "${GAME_FILTER}". Available: pirate, space, farm, detective, survival, academy, all`);
    process.exit(1);
  }

  const results: Array<{ game: GameDef; metrics: SimMetrics; duration: number }> = [];

  for (const game of gamesToRun) {
    printHeader(`Running: ${game.emoji} ${game.name} (${NUM_CHARS} characters)`);

    const { metrics, durationSec } = await runSimulation(game);
    results.push({ game, metrics, duration: durationSec });

    printGameResult(game, metrics, durationSec);
  }

  // ── Comparative summary ──────────────────────────────────
  if (results.length > 1) {
    printHeader('Comparative Summary');

    console.log(`\n  ${'Game'.padEnd(16)} ${'Decisions'.padEnd(11)} ${'Throughput'.padEnd(12)} ${'Tools Used'.padEnd(12)} ${'Tool Rate'.padEnd(11)} ${'Errors'.padEnd(8)} ${'p50'.padEnd(8)}`);
    console.log(`  ${'─'.repeat(78)}`);

    for (const { game, metrics: m, duration: d } of results) {
      const toolNames = Object.keys(m.tools);
      const toolTotal = Object.values(m.tools).reduce((a, b) => a + b, 0);
      const toolRate = ((toolTotal / Math.max(1, m.decisions)) * 100).toFixed(0);
      const p50 = percentile(m.latencies, 50);
      console.log(
        `  ${game.name.padEnd(16)} ${String(m.decisions).padEnd(11)} ${(m.decisions / d).toFixed(2).padEnd(12)} ${`${toolNames.length}/6`.padEnd(12)} ${(toolRate + '%').padEnd(11)} ${String(m.errors).padEnd(8)} ${p50.toFixed(0) + 'ms'}`,
      );
    }

    const totalDec = results.reduce((s, r) => s + r.metrics.decisions, 0);
    const totalErr = results.reduce((s, r) => s + r.metrics.errors, 0);
    const totalTok = results.reduce((s, r) => s + r.metrics.tokens, 0);
    const totalDur = results.reduce((s, r) => s + r.duration, 0);

    console.log(`\n  Total: ${totalDec} decisions, ${totalErr} errors, ${totalTok.toLocaleString()} tokens in ${totalDur.toFixed(1)}s`);
    console.log(`  Overall throughput: ${(totalDec / totalDur).toFixed(2)} decisions/sec`);
  }

  console.log('\n  Done.');
}

main().catch(console.error);
