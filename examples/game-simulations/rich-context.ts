/**
 * Rich Context Simulation — Demonstrates how deeper game stats
 * give the 1B model much better decision-making material.
 *
 * Compares a BARE game (minimal context) vs a RICH game (deep stats)
 * using the same tools, characters, and event flow.
 *
 * Usage:
 *   npx tsx examples/game-simulations/rich-context.ts
 *   npx tsx examples/game-simulations/rich-context.ts --chars=32 --ticks=15
 */

import { Engine, loadConfigFile } from '../../src/index';
import type {
  GamePlugin,
  ToolDefinition,
  CharacterDefinition,
  GameEvent,
  AgentDecisionResult,
  EngineConfig,
} from '../../src/index';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';

// ── CLI ─────────────────────────────────────────────────
function getNumArg(name: string, def: number): number {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? parseInt(a.split('=')[1], 10) : def;
}
const NUM_CHARS = getNumArg('chars', 32);
const TICKS = getNumArg('ticks', 15);
const PORT = getNumArg('port', 8100);

function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function rng(min: number, max: number) { return min + Math.floor(Math.random() * (max - min + 1)); }

// ── Character database (shared by both modes) ────────────
interface CharStats {
  hp: number; maxHp: number;
  mana: number; maxMana: number;
  stamina: number;
  gold: number; xp: number; level: number;
  strength: number; intelligence: number; agility: number;
  faction: string; factionStanding: number;
  inventory: string[];
  activeQuest: string | null;
  questProgress: string;
  combatStyle: string;
  knownRecipes: string[];
  statusEffects: string[];
  killCount: number; tradingProfit: number;
  location: string;
  lastAction: string;
}

const LOCATIONS = [
  'marketplace', 'guild_hall', 'dark_forest', 'mine_entrance',
  'castle_gate', 'tavern', 'alchemist_shop', 'training_grounds',
  'river_crossing', 'abandoned_tower',
];

const FACTIONS = ['Merchant Guild', 'Knights Order', 'Shadow Brotherhood', 'Scholars Circle', 'Free Folk'];
const QUESTS = [
  'Retrieve the stolen crown from the goblin caves',
  'Deliver medicine to the sick village elder',
  'Investigate strange lights in the abandoned tower',
  'Collect rare herbs for the alchemist',
  'Escort the merchant caravan through dark forest',
  'Find proof of corruption in the castle guard',
  'Map the underground tunnels beneath the mine',
  'Negotiate peace between the warring factions',
];
const RECIPES = ['healing_potion', 'fire_bomb', 'lockpick', 'antidote', 'smoke_bomb', 'strength_tonic', 'mana_crystal'];
const ITEMS = [
  'iron_sword', 'leather_armor', 'healing_potion', 'torch', 'rope', 'lockpick',
  'silver_ring', 'ancient_map', 'mana_crystal', 'fire_bomb', 'antidote',
  'enchanted_shield', 'poison_dagger', 'scholar_scroll', 'gold_amulet',
];
const STATUS_EFFECTS = ['well_rested', 'poisoned', 'blessed', 'fatigued', 'inspired', 'hungry', 'wounded'];
const COMBAT_STYLES = ['aggressive', 'defensive', 'tactical', 'stealthy', 'reckless'];

const ARCHETYPES = [
  { id: 'warrior', name: 'Warrior', traits: ['brave', 'strong'], goals: ['Become the champion', 'Protect the weak'] },
  { id: 'mage', name: 'Mage', traits: ['scholarly', 'curious'], goals: ['Master all elements', 'Decode the ancient tome'] },
  { id: 'rogue', name: 'Rogue', traits: ['cunning', 'quick'], goals: ['Pull off the perfect heist', 'Clear my name'] },
  { id: 'healer', name: 'Healer', traits: ['compassionate', 'wise'], goals: ['Cure the plague', 'Build a hospital'] },
  { id: 'ranger', name: 'Ranger', traits: ['perceptive', 'independent'], goals: ['Map the wilderness', 'Track the beast'] },
  { id: 'merchant', name: 'Merchant', traits: ['shrewd', 'charming'], goals: ['Monopolize the spice trade', 'Open a new shop'] },
  { id: 'alchemist', name: 'Alchemist', traits: ['meticulous', 'inventive'], goals: ['Create the philosopher stone', 'Brew the perfect elixir'] },
  { id: 'knight', name: 'Knight', traits: ['honorable', 'loyal'], goals: ['Earn a lordship', 'Defeat the dark knight'] },
];

const NAMES = [
  'Aldric', 'Brenna', 'Cassius', 'Delphine', 'Eamon', 'Freya', 'Gareth', 'Helena',
  'Idris', 'Juno', 'Kael', 'Liora', 'Magnus', 'Nyx', 'Orion', 'Petra',
  'Quinn', 'Rowena', 'Silas', 'Thalia', 'Ulric', 'Vera', 'Wyatt', 'Xara',
  'Yorick', 'Zara', 'Arlo', 'Blythe', 'Corvin', 'Daria', 'Elric', 'Faye',
];

function generateStats(archetype: string, index: number): CharStats {
  const baseLevel = 3 + rng(0, 12);
  return {
    hp: rng(40, 100), maxHp: 100,
    mana: archetype === 'mage' || archetype === 'alchemist' ? rng(50, 100) : rng(10, 40),
    maxMana: archetype === 'mage' || archetype === 'alchemist' ? 100 : 40,
    stamina: rng(30, 100),
    gold: rng(5, 500),
    xp: baseLevel * 100 + rng(0, 99),
    level: baseLevel,
    strength: archetype === 'warrior' || archetype === 'knight' ? rng(12, 20) : rng(5, 14),
    intelligence: archetype === 'mage' || archetype === 'alchemist' ? rng(14, 20) : rng(5, 14),
    agility: archetype === 'rogue' || archetype === 'ranger' ? rng(14, 20) : rng(5, 14),
    faction: FACTIONS[index % FACTIONS.length],
    factionStanding: rng(-20, 80),
    inventory: Array.from({ length: rng(2, 5) }, () => pick(ITEMS)),
    activeQuest: Math.random() > 0.3 ? pick(QUESTS) : null,
    questProgress: pick(['not_started', 'early', 'midway', 'nearly_complete']),
    combatStyle: pick(COMBAT_STYLES),
    knownRecipes: Array.from({ length: rng(0, 3) }, () => pick(RECIPES)),
    statusEffects: Array.from({ length: rng(0, 2) }, () => pick(STATUS_EFFECTS)),
    killCount: rng(0, 50),
    tradingProfit: rng(-100, 1000),
    location: LOCATIONS[index % LOCATIONS.length],
    lastAction: 'just arrived',
  };
}

// ── Tools (same for both modes) ──────────────────────────
function getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
  return [
    {
      definition: { name: 'attack', description: 'Attack a target in combat', parameters: [
        { name: 'target', type: 'string', description: 'Who or what to attack', required: true },
        { name: 'style', type: 'string', description: 'Combat approach', enum: ['heavy_strike', 'quick_jab', 'spell_cast', 'backstab', 'ranged_shot'], required: true },
      ]},
      executor: (args) => {
        const dmg = rng(5, 30);
        return { success: true, result: `Attacked ${args.target} with ${args.style} for ${dmg} damage. ${pick(['Critical hit!', 'Glancing blow.', 'Solid hit.', 'They dodged!'])}`,
          sideEffects: [{ type: 'combat', source: 'agent', data: { target: args.target, damage: dmg }, importance: 7, timestamp: Date.now() }],
        };
      },
    },
    {
      definition: { name: 'trade', description: 'Buy or sell items with a merchant or another character', parameters: [
        { name: 'action', type: 'string', description: 'Buy or sell', enum: ['buy', 'sell'], required: true },
        { name: 'item', type: 'string', description: 'What to trade', required: true },
        { name: 'target', type: 'string', description: 'Who to trade with', required: true },
      ]},
      executor: (args) => ({
        success: true, result: `${args.action === 'buy' ? 'Bought' : 'Sold'} ${args.item} ${args.action === 'buy' ? 'from' : 'to'} ${args.target}. ${pick(['Good deal!', 'Fair price.', 'Ripped off.', 'Bargain!'])}`,
        sideEffects: [{ type: 'trade', source: 'agent', data: { item: args.item }, timestamp: Date.now() }],
      }),
    },
    {
      definition: { name: 'craft', description: 'Craft an item using materials and recipes', parameters: [
        { name: 'recipe', type: 'string', description: 'What to craft', required: true },
        { name: 'material', type: 'string', description: 'Primary material', required: true },
      ]},
      executor: (args) => ({
        success: true, result: `Crafted ${args.recipe} from ${args.material}. ${pick(['Excellent quality!', 'Passable.', 'Failed — wasted materials.', 'Masterwork!'])}`,
      }),
    },
    {
      definition: { name: 'explore', description: 'Explore an area for secrets, resources, or paths', parameters: [
        { name: 'area', type: 'string', description: 'Where to explore', required: true },
        { name: 'method', type: 'string', description: 'How to explore', enum: ['search', 'sneak', 'survey', 'dig'], required: true },
      ]},
      executor: (args) => {
        const finds = ['a hidden passage', 'nothing of note', 'rare ore vein', 'ancient inscription', 'trapped chest', 'monster den', 'healing spring'];
        return { success: true, result: `Explored ${args.area} by ${args.method}: found ${pick(finds)}` };
      },
    },
    {
      definition: { name: 'rest', description: 'Rest to recover health, mana, and stamina', parameters: [
        { name: 'duration', type: 'string', description: 'How long to rest', enum: ['short', 'long', 'meditate'], required: true },
      ]},
      executor: (args) => ({
        success: true, result: `Rested (${args.duration}). ${pick(['Fully recovered.', 'Partially recovered.', 'Disturbed by noise.', 'Deep rest, feeling strong.'])}`,
      }),
    },
    {
      definition: { name: 'talk', description: 'Speak with someone to get info, persuade, or negotiate', parameters: [
        { name: 'target', type: 'string', description: 'Who to talk to', required: true },
        { name: 'intent', type: 'string', description: 'Purpose of conversation', enum: ['gather_info', 'persuade', 'intimidate', 'befriend', 'barter'], required: true },
      ]},
      executor: (args) => ({
        success: true, result: `Talked to ${args.target} (${args.intent}): ${pick(['They shared useful info.', 'They were suspicious.', 'Made a new ally.', 'They refused to talk.', 'Learned a secret.'])}`,
        sideEffects: [{ type: 'dialogue', source: 'agent', target: args.target as string, data: { intent: args.intent }, timestamp: Date.now() }],
      }),
    },
  ];
}

// ── Events ───────────────────────────────────────────────
const EVENTS: GameEvent[] = [
  { type: 'combat', source: 'goblin_raid', data: { description: 'Goblins attack the marketplace! Merchants scatter!' }, importance: 8, timestamp: 0 },
  { type: 'discovery', source: 'wanderer', data: { description: 'A dying traveler reveals the location of a dragon hoard.' }, importance: 7, timestamp: 0 },
  { type: 'trade', source: 'caravan', data: { description: 'A rare materials caravan arrives with exotic goods.' }, importance: 5, timestamp: 0 },
  { type: 'quest', source: 'guild_master', data: { description: 'The guild master posts an urgent bounty on the bandit leader.' }, importance: 8, timestamp: 0 },
  { type: 'dialogue', source: 'spy', data: { description: 'A hooded figure whispers about a conspiracy in the castle.' }, importance: 6, timestamp: 0 },
  { type: 'weather', source: 'nature', data: { description: 'A magical storm rolls in — mana surges in the air!' }, importance: 4, timestamp: 0 },
  { type: 'combat', source: 'dark_knight', data: { description: 'The dark knight challenges anyone brave enough to duel!' }, importance: 9, timestamp: 0 },
  { type: 'trade', source: 'black_market', data: { description: 'The black market opens tonight only. Rare items for sale.' }, importance: 6, timestamp: 0 },
];

// ══════════════════════════════════════════════════════════
//   BARE MODE — Minimal context (like the original sims)
// ══════════════════════════════════════════════════════════

function createBarePlugin(charCount: number): GamePlugin {
  const db = new Map<string, CharStats>();
  const chars: CharacterDefinition[] = [];

  for (let i = 0; i < charCount; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const stats = generateStats(arch.id, i);
    const id = `char-${i}`;
    db.set(id, stats);
    chars.push({
      id,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}.`,
        backstory: `A ${arch.name.toLowerCase()} from the ${stats.faction}.`,
        goals: arch.goals,
        traits: arch.traits,
      },
      initialCloseness: 40 + (i % 6) * 10,
    });
  }

  return {
    id: 'bare-rpg',
    name: 'Bare RPG',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: a.name,
      defaultIdentity: { personality: a.traits.join(', '), backstory: '', goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools: () => getTools(),
    getGameState: () => ({
      worldTime: Date.now(),
      location: 'The Kingdom',
      nearbyEntities: chars.slice(0, 8).map(c => c.name),
      recentEvents: ['A peaceful day in the kingdom.'],
    }),
    getProprioception: (id) => ({
      currentAction: 'idle',
      location: db.get(id)?.location ?? 'marketplace',
      status: ['alive'],
    }),
    getWorldRules: () => 'Fantasy RPG. Use tools to fight, trade, craft, explore, rest, or talk. Be concise.',
    getEventTypes: () => ['combat', 'discovery', 'trade', 'quest', 'dialogue', 'weather'],
    filterEvent: () => true,
  };
}

// ══════════════════════════════════════════════════════════
//   RICH MODE — Deep context, detailed stats
// ══════════════════════════════════════════════════════════

function createRichPlugin(charCount: number): GamePlugin {
  const db = new Map<string, CharStats>();
  const chars: CharacterDefinition[] = [];

  for (let i = 0; i < charCount; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    const stats = generateStats(arch.id, i);
    const id = `char-${i}`;
    db.set(id, stats);
    chars.push({
      id,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}. Level ${stats.level} with ${stats.combatStyle} combat style. Member of the ${stats.faction} (standing: ${stats.factionStanding > 50 ? 'respected' : stats.factionStanding > 0 ? 'neutral' : 'distrusted'}).`,
        backstory: `A level ${stats.level} ${arch.name.toLowerCase()} of the ${stats.faction}. Has slain ${stats.killCount} foes and earned ${stats.tradingProfit > 0 ? stats.tradingProfit + ' gold in trade' : 'nothing from trade yet'}. ${stats.knownRecipes.length > 0 ? 'Knows crafting recipes: ' + stats.knownRecipes.join(', ') + '.' : 'Knows no crafting recipes yet.'}`,
        goals: stats.activeQuest
          ? [...arch.goals, `Quest: ${stats.activeQuest} (${stats.questProgress})`]
          : arch.goals,
        traits: [...arch.traits, stats.combatStyle],
        speechStyle: arch.id === 'rogue' ? 'Speaks in whispers, uses thieves cant.'
          : arch.id === 'knight' ? 'Formal, chivalrous speech.'
          : arch.id === 'merchant' ? 'Always mentioning deals and prices.'
          : arch.id === 'mage' ? 'Uses arcane terminology.'
          : undefined,
      },
      initialCloseness: 40 + (i % 6) * 10,
    });
  }

  // World state evolves
  let worldThreat = rng(20, 60);
  let marketPrices = rng(80, 120);

  return {
    id: 'rich-rpg',
    name: 'Rich RPG',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: a.name,
      defaultIdentity: { personality: a.traits.join(', '), backstory: '', goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools: () => getTools(),
    getGameState: () => {
      // Evolve world
      worldThreat = Math.max(0, Math.min(100, worldThreat + rng(-10, 10)));
      marketPrices = Math.max(50, Math.min(200, marketPrices + rng(-15, 15)));

      const threatLevel = worldThreat > 70 ? 'DANGEROUS' : worldThreat > 40 ? 'moderate' : 'low';
      const economy = marketPrices > 130 ? 'inflated' : marketPrices > 90 ? 'stable' : 'depressed';

      return {
        worldTime: Date.now(),
        location: 'The Kingdom of Valdris',
        nearbyEntities: chars.slice(0, 12).map(c => c.name),
        recentEvents: [
          `Threat level: ${threatLevel} (${worldThreat}%)`,
          `Market prices: ${economy} (${marketPrices}% of normal)`,
          `${pick(['Goblin scouts spotted near the forest.', 'A merchant was robbed on the road.', 'The guild posted new bounties.', 'Rain dampened the training grounds.', 'A shipment of rare ores arrived.'])}`,
        ],
        custom: {
          threatLevel: worldThreat,
          marketPrices,
          timePhase: pick(['dawn', 'morning', 'afternoon', 'evening', 'night']),
          weather: pick(['clear', 'overcast', 'rain', 'storm', 'fog']),
          season: 'autumn',
        },
      };
    },
    getProprioception: (id) => {
      const s = db.get(id);
      if (!s) return { currentAction: 'idle', location: 'marketplace' };

      // Simulate some stat changes over time
      s.stamina = Math.max(0, Math.min(100, s.stamina + rng(-5, 3)));
      s.hp = Math.max(1, Math.min(s.maxHp, s.hp + rng(-3, 5)));
      if (s.mana < s.maxMana) s.mana = Math.min(s.maxMana, s.mana + rng(0, 5));

      const hpPct = Math.round((s.hp / s.maxHp) * 100);
      const healthDesc = hpPct > 80 ? 'healthy' : hpPct > 50 ? 'wounded' : hpPct > 25 ? 'badly_wounded' : 'near_death';
      const staminaDesc = s.stamina > 70 ? 'energetic' : s.stamina > 40 ? 'tired' : 'exhausted';

      return {
        currentAction: s.lastAction,
        location: s.location,
        inventory: s.inventory.slice(0, 6),
        energy: s.stamina / 100,
        status: [
          healthDesc,
          staminaDesc,
          ...s.statusEffects.slice(0, 2),
        ],
        custom: {
          hp: `${s.hp}/${s.maxHp}`,
          mana: `${s.mana}/${s.maxMana}`,
          gold: s.gold,
          level: s.level,
          strength: s.strength,
          intelligence: s.intelligence,
          agility: s.agility,
          faction: `${s.faction} (standing: ${s.factionStanding})`,
          quest: s.activeQuest ? `${s.activeQuest} [${s.questProgress}]` : 'none',
          combatStyle: s.combatStyle,
          knownRecipes: s.knownRecipes.length > 0 ? s.knownRecipes.join(', ') : 'none',
        },
      };
    },
    getWorldRules: () =>
      'Fantasy RPG in the Kingdom of Valdris. You are a character living in this world. '
      + 'Use your stats and situation to make smart decisions. '
      + 'Low HP → rest or heal. Active quest → pursue it. Low gold → trade or explore. '
      + 'High threat → prepare for combat. Good economy → trade for profit. '
      + 'Use tools to fight, trade, craft, explore, rest, or talk. Be concise.',
    getEventTypes: () => ['combat', 'discovery', 'trade', 'quest', 'dialogue', 'weather'],
    filterEvent: () => true,
  };
}

// ══════════════════════════════════════════════════════════
//   RUNNER
// ══════════════════════════════════════════════════════════

interface Metrics {
  decisions: number; errors: number; tokens: number;
  tools: Record<string, number>;
  dialogue: number; idle: number;
  latencies: number[];
  ticks: number;
}

function fresh(): Metrics {
  return { decisions: 0, errors: 0, tokens: 0, tools: {}, dialogue: 0, idle: 0, latencies: [], ticks: 0 };
}

async function runGame(name: string, plugin: GamePlugin): Promise<{ m: Metrics; dur: number }> {
  const m = fresh();

  // Try config file first, fall back to vLLM auto-detect
  let config: EngineConfig;
  let modelName = 'default';
  try {
    config = loadConfigFile();
    config.database = { path: ':memory:' };
    config.tick = { fastTickMs: 800, slowTickMs: 8000, batchSize: NUM_CHARS };
    config.logging = { level: 'error' };
    modelName = config.inference.models.heavy;
  } catch {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
      const d = await r.json() as { data: Array<{ id: string }> };
      if (d.data?.[0]?.id) modelName = d.data[0].id;
    } catch {}
    config = {
      database: { path: ':memory:' },
      inference: { type: 'vllm', baseUrl: `http://127.0.0.1:${PORT}/v1`,
        models: { heavy: modelName, mid: modelName, light: modelName },
        maxConcurrency: 64, timeoutMs: 60000 },
      tick: { fastTickMs: 800, slowTickMs: 8000, batchSize: NUM_CHARS },
      logging: { level: 'error' },
    };
  }

  const engine = new Engine(config);

  engine.events.on('agent:decision', (r: AgentDecisionResult) => {
    m.decisions++;
    m.tokens += r.tokensUsed;
    m.latencies.push(r.durationMs);
    if ('toolName' in r.action) {
      const n = (r.action as any).toolName;
      m.tools[n] = (m.tools[n] ?? 0) + 1;
    } else if (r.action.type === 'dialogue') {
      m.dialogue++;
    } else {
      m.idle++;
    }
  });
  engine.events.on('agent:error', () => m.errors++);
  engine.events.on('tick:fast', () => m.ticks++);

  await engine.loadPlugin(plugin);
  const start = Date.now();
  engine.start();

  const evInterval = setInterval(async () => {
    try { await engine.injectEvent({ ...pick(EVENTS), timestamp: Date.now() }); } catch {}
  }, 2500);

  await new Promise<void>(resolve => {
    const check = setInterval(() => {
      if (m.ticks >= TICKS) { clearInterval(check); resolve(); }
    }, 200);
  });

  clearInterval(evInterval);
  await engine.stop();

  return { m, dur: (Date.now() - start) / 1000 };
}

function pct(n: number, total: number) { return ((n / Math.max(1, total)) * 100).toFixed(1); }
function p50(arr: number[]) { const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length / 2)] ?? 0; }

function printResult(label: string, m: Metrics, dur: number) {
  const toolTotal = Object.values(m.tools).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(m.tools).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;
  const maxBar = 28;

  console.log(`\n  ── ${label} ──`);
  console.log(`  Decisions: ${m.decisions}  |  Tool rate: ${pct(toolTotal, m.decisions)}%  |  Errors: ${m.errors}`);
  console.log(`  Throughput: ${(m.decisions / dur).toFixed(2)}/s  |  p50: ${p50(m.latencies).toFixed(0)}ms  |  Duration: ${dur.toFixed(1)}s`);
  console.log(`  Tokens: ${m.tokens.toLocaleString()}  |  Dialogue: ${m.dialogue} (${pct(m.dialogue, m.decisions)}%)  |  Idle: ${m.idle} (${pct(m.idle, m.decisions)}%)\n`);

  console.log('  Tool Distribution:');
  for (const [name, count] of sorted) {
    const bar = '█'.repeat(Math.max(1, Math.round((count / maxCount) * maxBar)));
    console.log(`    ${name.padEnd(14)} ${bar} ${count} (${pct(count, m.decisions)}%)`);
  }

  // Gini
  const vals = Object.values(m.tools);
  if (vals.length > 1) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    let gini = 0;
    for (const a of vals) for (const b of vals) gini += Math.abs(a - b);
    gini /= 2 * vals.length * vals.length * mean;
    console.log(`\n  Balance: ${((1 - gini) * 100).toFixed(0)}% (Gini=${gini.toFixed(3)})`);
  }
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Rich Context Experiment — Bare vs Rich Game Stats     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Characters: ${NUM_CHARS}  |  Ticks: ${TICKS}  |  Port: ${PORT}`);

  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error();
    console.log('  vLLM: connected\n');
  } catch {
    console.log('  ERROR: vLLM not available. Start it first.');
    process.exit(1);
  }

  // Run BARE mode
  console.log('═'.repeat(60));
  console.log('  Running BARE mode (minimal context)...');
  console.log('═'.repeat(60));
  const bare = await runGame('Bare RPG', createBarePlugin(NUM_CHARS));
  printResult('BARE MODE — Minimal Context', bare.m, bare.dur);

  // Run RICH mode
  console.log('\n' + '═'.repeat(60));
  console.log('  Running RICH mode (deep game stats)...');
  console.log('═'.repeat(60));
  const rich = await runGame('Rich RPG', createRichPlugin(NUM_CHARS));
  printResult('RICH MODE — Deep Game Stats', rich.m, rich.dur);

  // ── Comparison ──────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    HEAD-TO-HEAD                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const bToolRate = pct(Object.values(bare.m.tools).reduce((a,b) => a+b, 0), bare.m.decisions);
  const rToolRate = pct(Object.values(rich.m.tools).reduce((a,b) => a+b, 0), rich.m.decisions);

  const bVals = Object.values(bare.m.tools);
  const rVals = Object.values(rich.m.tools);
  const gini = (vals: number[]) => {
    if (vals.length < 2) return 0;
    const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
    let s = 0;
    for (const a of vals) for (const b of vals) s += Math.abs(a - b);
    return s / (2 * vals.length * vals.length * mean);
  };

  console.log(`\n  ${'Metric'.padEnd(24)} ${'BARE'.padEnd(16)} ${'RICH'.padEnd(16)} ${'Winner'}`);
  console.log(`  ${'─'.repeat(72)}`);
  console.log(`  ${'Decisions'.padEnd(24)} ${String(bare.m.decisions).padEnd(16)} ${String(rich.m.decisions).padEnd(16)} ${bare.m.decisions > rich.m.decisions ? 'BARE' : 'RICH'}`);
  console.log(`  ${'Tool Rate'.padEnd(24)} ${(bToolRate + '%').padEnd(16)} ${(rToolRate + '%').padEnd(16)} ${parseFloat(bToolRate) > parseFloat(rToolRate) ? 'BARE' : parseFloat(rToolRate) > parseFloat(bToolRate) ? 'RICH' : 'TIE'}`);
  console.log(`  ${'Dialogue'.padEnd(24)} ${(pct(bare.m.dialogue, bare.m.decisions) + '%').padEnd(16)} ${(pct(rich.m.dialogue, rich.m.decisions) + '%').padEnd(16)} ${bare.m.dialogue < rich.m.dialogue ? 'BARE' : 'RICH'}`);
  console.log(`  ${'Idle'.padEnd(24)} ${(pct(bare.m.idle, bare.m.decisions) + '%').padEnd(16)} ${(pct(rich.m.idle, rich.m.decisions) + '%').padEnd(16)} ${bare.m.idle < rich.m.idle ? 'BARE' : 'RICH'}`);
  console.log(`  ${'Tool Balance'.padEnd(24)} ${(((1-gini(bVals))*100).toFixed(0) + '%').padEnd(16)} ${(((1-gini(rVals))*100).toFixed(0) + '%').padEnd(16)} ${gini(bVals) < gini(rVals) ? 'BARE' : 'RICH'}`);
  console.log(`  ${'Tools Used'.padEnd(24)} ${(Object.keys(bare.m.tools).length + '/6').padEnd(16)} ${(Object.keys(rich.m.tools).length + '/6').padEnd(16)} ${Object.keys(bare.m.tools).length >= Object.keys(rich.m.tools).length ? 'BARE' : 'RICH'}`);
  console.log(`  ${'Errors'.padEnd(24)} ${String(bare.m.errors).padEnd(16)} ${String(rich.m.errors).padEnd(16)} ${bare.m.errors <= rich.m.errors ? 'BARE' : 'RICH'}`);
  console.log(`  ${'Throughput'.padEnd(24)} ${((bare.m.decisions/bare.dur).toFixed(2) + '/s').padEnd(16)} ${((rich.m.decisions/rich.dur).toFixed(2) + '/s').padEnd(16)} ${bare.m.decisions/bare.dur > rich.m.decisions/rich.dur ? 'BARE' : 'RICH'}`);
  console.log(`  ${'p50 Latency'.padEnd(24)} ${(p50(bare.m.latencies).toFixed(0) + 'ms').padEnd(16)} ${(p50(rich.m.latencies).toFixed(0) + 'ms').padEnd(16)} ${p50(bare.m.latencies) < p50(rich.m.latencies) ? 'BARE' : 'RICH'}`);

  console.log('\n  Done.');
}

main().catch(console.error);
