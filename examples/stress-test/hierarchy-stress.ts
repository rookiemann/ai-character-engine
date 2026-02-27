/**
 * Hierarchy Stress Test — Corporate + Faction Warfare at Max Scale
 *
 * Exercises every HierarchyManager feature with two competing factions:
 *   Phase 1 — Warm-up: baseline decisions with hierarchy prompts active
 *   Phase 2 — Orders: leaders issue commands, InitiativeChecker fires
 *   Phase 3 — Succession: kill leaders, watch auto-promotion chains
 *   Phase 4 — Warfare: cross-faction combat, battlefield promotions
 *
 * Usage:
 *   npx tsx examples/stress-test/hierarchy-stress.ts --vllm --chars=32
 *   npx tsx examples/stress-test/hierarchy-stress.ts --vllm --chars=128 --batch=128 --concurrency=128 --fast-ms=3000
 */

import { Engine } from '../../src/index';
import type {
  GamePlugin,
  ArchetypeDefinition,
  CharacterDefinition,
  ToolDefinition,
  GameState,
  CharacterProprioception,
  GameEvent,
  AgentDecisionResult,
  HierarchyDefinition,
} from '../../src/index';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';

// ── CLI args ─────────────────────────────────────────────────

function getArg(name: string, defaultVal: number): number {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : defaultVal;
}

function getStringArg(name: string, defaultVal: string): string {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultVal;
}

const NUM_CHARS = getArg('chars', 32);
const TARGET_FAST_TICKS = getArg('ticks', 32);
const FAST_TICK_MS = getArg('fast-ms', 800);
const SLOW_TICK_MS = getArg('slow-ms', 8000);
const BATCH_SIZE = getArg('batch', 32);
const MAX_CONCURRENCY = getArg('concurrency', 64);
const EVENT_INTERVAL_MS = getArg('event-ms', 2000);
const PHASE_TICKS = getArg('phase-ticks', 8);
const VLLM_PORT = getArg('port', 8100);
const EMBED_URL = getStringArg('embed-url', 'http://172.18.64.1:1234/v1');
const EMBED_MODEL = getStringArg('embed-model', 'text-embedding-nomic-embed-text-v2-moe@q8_0');
const USE_EMBEDDINGS = process.argv.includes('--embeddings');
const USE_VLLM = process.argv.includes('--vllm') || !process.argv.includes('--lmstudio');

// ── Constants ────────────────────────────────────────────────

const LOCATIONS = ['town_square', 'marketplace', 'tavern', 'docks', 'temple', 'barracks', 'forest_edge', 'castle_gate'];
const EVENT_TYPES = ['trade', 'combat', 'dialogue', 'discovery', 'quest_start', 'meeting', 'conflict', 'gift', 'alliance', 'routine'];

const ACME_NAMES = [
  'Anderson', 'Brooks', 'Carter', 'Davis', 'Edwards', 'Foster', 'Grant', 'Hayes',
  'Irving', 'Jensen', 'Klein', 'Lawson', 'Mitchell', 'Norton', 'Owens', 'Palmer',
  'Quinn', 'Roberts', 'Sullivan', 'Turner', 'Underwood', 'Vance', 'Wallace', 'Xavier',
  'York', 'Zhang', 'Abbott', 'Barnes', 'Chambers', 'Dixon', 'Ellis', 'Faulkner',
  'Gibson', 'Hamilton', 'Ingram', 'Jackson', 'Kemp', 'Lambert', 'Mason', 'Nash',
  'Ortiz', 'Payne', 'Reeves', 'Shaw', 'Tate', 'Upton', 'Vernon', 'Wade',
  'Yates', 'Zimmerman', 'Allen', 'Bishop', 'Clark', 'Dean', 'Evans', 'Finch',
  'Gould', 'Hart', 'Irwin', 'Joyce', 'King', 'Long', 'Marsh', 'Nolan',
];

const GUILD_NAMES = [
  'Whisper', 'Shade', 'Raven', 'Dagger', 'Venom', 'Eclipse', 'Phantom', 'Thorn',
  'Wraith', 'Onyx', 'Ember', 'Frost', 'Sable', 'Viper', 'Storm', 'Ash',
  'Nightfall', 'Crimson', 'Hollow', 'Drift', 'Scorch', 'Mist', 'Blade', 'Cinder',
  'Talon', 'Spark', 'Gloom', 'Flint', 'Haze', 'Steel', 'Wisp', 'Fang',
  'Coil', 'Dusk', 'Gleam', 'Slate', 'Pike', 'Reed', 'Bolt', 'Soot',
  'Pyre', 'Grit', 'Silk', 'Iron', 'Wren', 'Fox', 'Lynx', 'Hawk',
  'Moth', 'Crow', 'Vale', 'Reef', 'Jade', 'Opal', 'Rust', 'Moss',
  'Quill', 'Bone', 'Husk', 'Seal', 'Lark', 'Briar', 'Rime', 'Crag',
];

const ARCHETYPES = ['warrior', 'merchant', 'scholar', 'rogue', 'healer', 'smith'];
const TRAITS_POOL = ['brave', 'cunning', 'kind', 'greedy', 'loyal', 'suspicious', 'creative', 'stubborn', 'patient', 'impulsive', 'wise', 'naive'];
const GOALS_POOL = [
  'Protect the village', 'Find rare artifacts', 'Build a trade empire', 'Uncover ancient secrets',
  'Seek revenge', 'Find a lost friend', 'Earn the king\'s favor', 'Master a craft',
  'Explore unknown lands', 'Heal the sick', 'Defeat the bandits', 'Write a great book',
];

// Faction definitions
const ACME_FACTION: HierarchyDefinition = {
  factionId: 'acme_corp',
  factionName: 'Acme Corp',
  ranks: [
    { level: 0, name: 'CEO', maxMembers: 1 },
    { level: 1, name: 'VP', maxMembers: 3 },
    { level: 2, name: 'Manager' },
    { level: 3, name: 'Employee' },
  ],
};

const GUILD_FACTION: HierarchyDefinition = {
  factionId: 'shadow_guild',
  factionName: 'Shadow Guild',
  ranks: [
    { level: 0, name: 'Guildmaster', maxMembers: 1 },
    { level: 1, name: 'Lieutenant', maxMembers: 3 },
    { level: 2, name: 'Agent' },
    { level: 3, name: 'Recruit' },
  ],
};

// Order templates
const ACME_ORDERS = [
  'Investigate marketplace profits',
  'Trade with the next merchant you find',
  'Report on activities at the docks',
  'Negotiate a deal at the tavern',
  'Scout the barracks for talent',
  'Review inventory at the marketplace',
];

const GUILD_ORDERS = [
  'Scout the docks for targets',
  'Fight anyone suspicious at the tavern',
  'Investigate the temple for secrets',
  'Move to the forest edge and report back',
  'Trade stolen goods at the marketplace',
  'Rest and prepare for the next operation',
];

// ── Hierarchy Metrics ────────────────────────────────────────

interface HierarchyMetrics {
  ordersIssued: number;
  ordersByFaction: Record<string, number>;
  orderInitiatives: number;
  promotions: number;
  demotions: number;
  successionEvents: number;
  successionDetails: Array<{ factionId: string; promotedId: string; toRank: number; timestamp: number }>;
  leaderDeaths: number;
  totalDeaths: number;
  crossFactionFights: number;
  intraFactionTalks: number;
  phaseTimings: Record<string, { startMs: number; endMs: number; decisions: number }>;
}

interface StandardMetrics {
  totalDecisions: number;
  totalTokens: number;
  totalDurationMs: number;
  toolCalls: Record<string, number>;
  dialogueCount: number;
  idleCount: number;
  errorCount: number;
  latencies: number[];
  tierChanges: number;
  memoriesCreated: number;
  eventsInjected: number;
  ticksFast: number;
  ticksSlow: number;
}

const hMetrics: HierarchyMetrics = {
  ordersIssued: 0,
  ordersByFaction: {},
  orderInitiatives: 0,
  promotions: 0,
  demotions: 0,
  successionEvents: 0,
  successionDetails: [],
  leaderDeaths: 0,
  totalDeaths: 0,
  crossFactionFights: 0,
  intraFactionTalks: 0,
  phaseTimings: {},
};

const sMetrics: StandardMetrics = {
  totalDecisions: 0,
  totalTokens: 0,
  totalDurationMs: 0,
  toolCalls: {},
  dialogueCount: 0,
  idleCount: 0,
  errorCount: 0,
  latencies: [],
  tierChanges: 0,
  memoriesCreated: 0,
  eventsInjected: 0,
  ticksFast: 0,
  ticksSlow: 0,
};

// ── World State ──────────────────────────────────────────────

const worldState = {
  time: 0,
  weather: 'clear' as string,
  tension: 50,
  charLocations: new Map<string, string>(),
};

// ── Helpers ──────────────────────────────────────────────────

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Compute pyramid rank distribution for N members in a faction */
function computeRankDistribution(n: number): [number, number, number, number] {
  const rank0 = 1;
  const rank1 = Math.min(3, Math.max(2, Math.floor(n * 0.15)));
  const rank2 = Math.max(1, Math.floor(n * 0.25));
  const rank3 = Math.max(1, n - rank0 - rank1 - rank2);
  return [rank0, rank1, rank2, rank3];
}

// Track faction membership for quick lookups
const characterFactions = new Map<string, string>(); // charId → factionId

function getCharFaction(charId: string): string | null {
  return characterFactions.get(charId) ?? null;
}

function randomEvent(): GameEvent {
  const type = randomFrom(EVENT_TYPES);
  const source = `char-${Math.floor(Math.random() * NUM_CHARS)}`;
  const target = `char-${Math.floor(Math.random() * NUM_CHARS)}`;
  return {
    type,
    source,
    target: source !== target ? target : undefined,
    data: {
      location: randomFrom(LOCATIONS),
      detail: `A ${type} event occurred`,
    },
    importance: Math.floor(Math.random() * 8) + 2,
    timestamp: Date.now(),
  };
}

// ── Scaling Config ───────────────────────────────────────────

function getScalingConfig(chars: number) {
  if (chars <= 32) return { batch: 32, concurrency: 64, fastMs: 800, timeoutMs: 60000 };
  if (chars <= 64) return { batch: 64, concurrency: 64, fastMs: 1200, timeoutMs: 90000 };
  if (chars <= 96) return { batch: 96, concurrency: 128, fastMs: 2000, timeoutMs: 120000 };
  return { batch: 128, concurrency: 128, fastMs: 3000, timeoutMs: 120000 };
}

// ── Plugin ───────────────────────────────────────────────────

function createHierarchyPlugin(): GamePlugin {
  const perFaction = Math.floor(NUM_CHARS / 2);
  const [r0, r1, r2, r3] = computeRankDistribution(perFaction);

  return {
    id: 'hierarchy-stress',
    name: 'Hierarchy Stress Test — Corporate + Faction Warfare',

    getArchetypes(): ArchetypeDefinition[] {
      return ARCHETYPES.map(a => ({
        id: a,
        name: a.charAt(0).toUpperCase() + a.slice(1),
        description: `A ${a} archetype`,
        defaultIdentity: {
          personality: `A typical ${a}`,
          backstory: `Has been a ${a} for years`,
          goals: [randomFrom(GOALS_POOL)],
          traits: [randomFrom(TRAITS_POOL), randomFrom(TRAITS_POOL)],
        },
      }));
    },

    getInitialCharacters(): CharacterDefinition[] {
      const chars: CharacterDefinition[] = [];

      // Build Acme Corp members
      for (let i = 0; i < perFaction; i++) {
        const name = ACME_NAMES[i % ACME_NAMES.length];
        let rank: number;
        let rankTitle: string;
        if (i < r0) { rank = 0; rankTitle = 'CEO'; }
        else if (i < r0 + r1) { rank = 1; rankTitle = 'VP'; }
        else if (i < r0 + r1 + r2) { rank = 2; rankTitle = 'Manager'; }
        else { rank = 3; rankTitle = 'Employee'; }

        const loc = randomFrom(LOCATIONS);
        const charId = `char-${i}`;
        worldState.charLocations.set(charId, loc);
        characterFactions.set(charId, 'acme_corp');

        chars.push({
          id: charId,
          name: `${name}`,
          archetype: ARCHETYPES[i % ARCHETYPES.length],
          identity: {
            personality: `A loyal ${rankTitle} of Acme Corp who ${rank <= 1 ? 'leads with authority' : 'follows orders from superiors'}. ${randomFrom(TRAITS_POOL)} and ${randomFrom(TRAITS_POOL)}.`,
            backstory: `${name} joined Acme Corp years ago and rose to the rank of ${rankTitle}. Works near ${loc}.`,
            goals: [randomFrom(GOALS_POOL)],
            traits: [randomFrom(TRAITS_POOL), randomFrom(TRAITS_POOL), randomFrom(TRAITS_POOL)],
            speechStyle: rank <= 1 ? 'Speaks with authority and confidence.' : 'Speaks respectfully to superiors.',
          },
          initialCloseness: Math.floor(Math.random() * 60) + 20,
          metadata: { faction: 'acme_corp', rank },
        });
      }

      // Build Shadow Guild members
      for (let i = 0; i < perFaction; i++) {
        const name = GUILD_NAMES[i % GUILD_NAMES.length];
        let rank: number;
        let rankTitle: string;
        if (i < r0) { rank = 0; rankTitle = 'Guildmaster'; }
        else if (i < r0 + r1) { rank = 1; rankTitle = 'Lieutenant'; }
        else if (i < r0 + r1 + r2) { rank = 2; rankTitle = 'Agent'; }
        else { rank = 3; rankTitle = 'Recruit'; }

        const loc = randomFrom(LOCATIONS);
        const globalIdx = perFaction + i;
        const charId = `char-${globalIdx}`;
        worldState.charLocations.set(charId, loc);
        characterFactions.set(charId, 'shadow_guild');

        chars.push({
          id: charId,
          name: `${name}`,
          archetype: ARCHETYPES[globalIdx % ARCHETYPES.length],
          identity: {
            personality: `A cunning ${rankTitle} of the Shadow Guild who ${rank <= 1 ? 'commands from the shadows' : 'obeys the chain of command'}. ${randomFrom(TRAITS_POOL)} and ${randomFrom(TRAITS_POOL)}.`,
            backstory: `${name} was recruited into the Shadow Guild and earned the rank of ${rankTitle}. Operates near ${loc}.`,
            goals: [randomFrom(GOALS_POOL)],
            traits: [randomFrom(TRAITS_POOL), randomFrom(TRAITS_POOL), randomFrom(TRAITS_POOL)],
            speechStyle: rank <= 1 ? 'Speaks in hushed, commanding tones.' : 'Speaks carefully, always watchful.',
          },
          initialCloseness: Math.floor(Math.random() * 60) + 20,
          metadata: { faction: 'shadow_guild', rank },
        });
      }

      return chars;
    },

    getHierarchyDefinitions(): HierarchyDefinition[] {
      return [ACME_FACTION, GUILD_FACTION];
    },

    onSuccession(factionId: string, vacatedRank: number, candidates: Array<{ characterId: string; score: number }>): string | null {
      const factionName = factionId === 'acme_corp' ? 'Acme Corp' : 'Shadow Guild';
      const rankName = factionId === 'acme_corp'
        ? ACME_FACTION.ranks.find(r => r.level === vacatedRank)?.name ?? `Rank ${vacatedRank}`
        : GUILD_FACTION.ranks.find(r => r.level === vacatedRank)?.name ?? `Rank ${vacatedRank}`;
      console.log(`  [SUCCESSION] ${factionName} ${rankName} vacancy — ${candidates.length} candidates`);
      // Return null to let engine auto-promote
      return null;
    },

    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: {
            name: 'move_to',
            description: 'Move to a location',
            parameters: [
              { name: 'location', type: 'string', description: 'Where to go', enum: LOCATIONS, required: true },
            ],
          },
          executor: (args) => {
            return { success: true, result: `Moved to ${args.location}` };
          },
        },
        {
          definition: {
            name: 'talk_to',
            description: 'Start a conversation with someone nearby',
            parameters: [
              { name: 'target', type: 'string', description: 'Who to talk to', required: true },
              { name: 'topic', type: 'string', description: 'What to say', required: true },
            ],
          },
          executor: (args) => {
            return {
              success: true,
              result: `Talked to ${args.target} about ${args.topic}`,
              sideEffects: [{
                type: 'dialogue',
                source: 'agent',
                target: args.target as string,
                data: { topic: args.topic },
                timestamp: Date.now(),
              }],
            };
          },
        },
        {
          definition: {
            name: 'trade',
            description: 'Trade items with someone',
            parameters: [
              { name: 'target', type: 'string', description: 'Trade partner', required: true },
              { name: 'offer', type: 'string', description: 'What you offer', required: true },
              { name: 'request', type: 'string', description: 'What you want', required: true },
            ],
          },
          executor: (args) => {
            return { success: true, result: `Trade proposed: offer ${args.offer} for ${args.request}` };
          },
        },
        {
          definition: {
            name: 'fight',
            description: 'Attack or defend against a target',
            parameters: [
              { name: 'target', type: 'string', description: 'Who to fight', required: true },
              { name: 'style', type: 'string', description: 'How to fight', enum: ['aggressive', 'defensive', 'tactical'], required: true },
            ],
          },
          executor: (args) => {
            return {
              success: true,
              result: `Fought ${args.target} with ${args.style} style`,
              sideEffects: [{
                type: 'combat',
                source: 'agent',
                target: args.target as string,
                data: { style: args.style },
                importance: 7,
                timestamp: Date.now(),
              }],
            };
          },
        },
        {
          definition: {
            name: 'investigate',
            description: 'Investigate something or someone',
            parameters: [
              { name: 'subject', type: 'string', description: 'What to investigate', required: true },
            ],
          },
          executor: (args) => {
            const findings = ['nothing unusual', 'a hidden message', 'signs of recent activity', 'a clue', 'danger approaching'];
            return { success: true, result: `Investigation of ${args.subject}: found ${randomFrom(findings)}` };
          },
        },
        {
          definition: {
            name: 'rest',
            description: 'Take a rest to recover',
            parameters: [],
          },
          executor: () => {
            return { success: true, result: 'Rested and recovered some energy' };
          },
        },
      ];
    },

    getGameState(): GameState {
      return {
        worldTime: worldState.time,
        location: 'The World',
        nearbyEntities: Array.from(worldState.charLocations.entries())
          .map(([id, loc]) => `${id} at ${loc}`),
        recentEvents: [
          `World tension: ${worldState.tension}`,
          `Weather: ${worldState.weather}`,
          'Two factions vie for control: Acme Corp (corporate hierarchy) and Shadow Guild (covert network).',
        ],
        custom: {
          weather: worldState.weather,
          tension: worldState.tension,
          time: worldState.time,
        },
      };
    },

    getProprioception(characterId: string): CharacterProprioception {
      const loc = worldState.charLocations.get(characterId) ?? 'unknown';
      return {
        currentAction: 'idle',
        location: loc,
        inventory: ['basic supplies'],
        status: ['healthy'],
        energy: 0.7 + Math.random() * 0.3,
      };
    },

    getWorldRules(): string {
      return [
        'Medieval fantasy world with two rival factions.',
        'Acme Corp: a corporate hierarchy led by a CEO, with VPs, Managers, and Employees.',
        'Shadow Guild: a covert network led by a Guildmaster, with Lieutenants, Agents, and Recruits.',
        'Characters should follow orders from superiors in their faction.',
        'Cross-faction conflict is common. Be concise. Use tools when appropriate.',
      ].join(' ');
    },

    getEventTypes(): string[] {
      return EVENT_TYPES;
    },

    onFastTick(timestamp: number) {
      worldState.time++;
      if (worldState.time % 10 === 0) {
        worldState.weather = randomFrom(['clear', 'cloudy', 'rainy', 'foggy', 'stormy']);
      }
      worldState.tension = Math.max(0, Math.min(100,
        worldState.tension + (Math.random() - 0.5) * 10,
      ));
    },
  };
}

// ── Phase Management ─────────────────────────────────────────

type Phase = 'warmup' | 'orders' | 'succession' | 'warfare';

const PHASE_SEQUENCE: Phase[] = ['warmup', 'orders', 'succession', 'warfare'];

function getPhase(tickCount: number): Phase {
  const phaseIdx = Math.min(
    Math.floor(tickCount / PHASE_TICKS),
    PHASE_SEQUENCE.length - 1,
  );
  return PHASE_SEQUENCE[phaseIdx];
}

function getPhaseNumber(tickCount: number): number {
  return Math.min(
    Math.floor(tickCount / PHASE_TICKS),
    PHASE_SEQUENCE.length - 1,
  );
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const scaling = getScalingConfig(NUM_CHARS);
  const effectiveBatch = getArg('batch', scaling.batch) || scaling.batch;
  const effectiveConcurrency = getArg('concurrency', scaling.concurrency) || scaling.concurrency;
  const effectiveFastMs = getArg('fast-ms', scaling.fastMs) || scaling.fastMs;
  const effectiveTimeout = scaling.timeoutMs;
  const perFaction = Math.floor(NUM_CHARS / 2);
  const [r0, r1, r2, r3] = computeRankDistribution(perFaction);
  const totalTicks = PHASE_TICKS * PHASE_SEQUENCE.length;

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     AI Character Engine — Hierarchy Stress Test             ║');
  console.log('║     Corporate + Faction Warfare at Max Scale                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Characters:    ${NUM_CHARS} (${perFaction}/faction)`);
  console.log(`  Rank pyramid:  CEO/GM=1, VP/Lt=${r1}, Mgr/Agt=${r2}, Emp/Rec=${r3}`);
  console.log(`  Phases:        ${PHASE_SEQUENCE.length} x ${PHASE_TICKS} ticks = ${totalTicks} total`);
  console.log(`  Fast tick:     ${effectiveFastMs}ms`);
  console.log(`  Batch:         ${effectiveBatch}, Concurrency: ${effectiveConcurrency}`);
  console.log(`  Timeout:       ${effectiveTimeout}ms`);
  console.log(`  Embeddings:    ${USE_EMBEDDINGS ? `enabled (${EMBED_URL})` : 'disabled'}`);
  console.log('');

  // Clean previous test DB
  const fs = await import('fs');
  try { fs.unlinkSync('./data/hierarchy-stress.db'); } catch {}
  try { fs.unlinkSync('./data/hierarchy-stress.db-wal'); } catch {}
  try { fs.unlinkSync('./data/hierarchy-stress.db-shm'); } catch {}

  // Auto-detect model name
  let vllmModelName = 'default-model';
  if (USE_VLLM) {
    try {
      const resp = await fetch(`http://127.0.0.1:${VLLM_PORT}/v1/models`);
      const data = await resp.json() as { data: Array<{ id: string }> };
      if (data.data?.[0]?.id) {
        vllmModelName = data.data[0].id;
      }
    } catch { /* use default */ }
  }

  const inferenceConfig = USE_VLLM
    ? {
        type: 'vllm' as const,
        baseUrl: `http://127.0.0.1:${VLLM_PORT}/v1`,
        models: { heavy: vllmModelName, mid: vllmModelName, light: vllmModelName },
        maxConcurrency: effectiveConcurrency,
        timeoutMs: effectiveTimeout,
      }
    : {
        type: 'lmstudio' as const,
        baseUrl: 'http://192.168.1.136:1234/v1',
        models: {
          heavy: 'qwen2.5-7b-instruct-uncensored',
          mid: 'qwen2.5-7b-instruct-uncensored',
          light: 'qwen2.5-7b-instruct-uncensored',
        },
        maxConcurrency: effectiveConcurrency,
        timeoutMs: effectiveTimeout,
      };

  console.log(`  Provider: ${inferenceConfig.type} @ ${inferenceConfig.baseUrl}`);
  console.log(`  Model:    ${USE_VLLM ? vllmModelName : 'qwen2.5-7b-instruct-uncensored'}`);
  console.log('');

  const embeddingConfig = USE_EMBEDDINGS ? {
    embedding: {
      type: 'lmstudio' as const,
      baseUrl: EMBED_URL,
      models: { heavy: EMBED_MODEL, mid: EMBED_MODEL, light: EMBED_MODEL },
      maxConcurrency: 4,
      timeoutMs: 10000,
    },
  } : {};

  const engine = new Engine({
    database: { path: './data/hierarchy-stress.db' },
    inference: inferenceConfig,
    ...embeddingConfig,
    tick: {
      fastTickMs: effectiveFastMs,
      slowTickMs: SLOW_TICK_MS,
      maxAgentsPerFastTick: NUM_CHARS,
      maxAgentsPerSlowTick: NUM_CHARS,
      batchSize: effectiveBatch,
    },
    memory: {
      workingMemorySize: 5,
      episodicRetrievalCount: 3,
      importanceThreshold: 3,
      decayInterval: 5,
      pruneThreshold: 0.5,
      summaryRegenerateInterval: 20,
    },
    logging: { level: 'warn', pretty: false },
  });

  // ── Event Wiring: Standard ──────────────────────────────────

  engine.events.on('agent:decision', (result: AgentDecisionResult) => {
    sMetrics.totalDecisions++;
    sMetrics.totalTokens += result.tokensUsed;
    sMetrics.totalDurationMs += result.durationMs;
    sMetrics.latencies.push(result.durationMs);

    if ('toolName' in result.action) {
      const name = (result.action as any).toolName;
      sMetrics.toolCalls[name] = (sMetrics.toolCalls[name] ?? 0) + 1;

      // Track cross-faction fights
      if (name === 'fight') {
        const actorFaction = getCharFaction(result.characterId);
        const targetId = (result.action as any).args?.target as string | undefined;
        if (targetId && actorFaction) {
          const targetFaction = getCharFaction(targetId);
          if (targetFaction && targetFaction !== actorFaction) {
            hMetrics.crossFactionFights++;
          }
        }
      }

      // Track intra-faction talks
      if (name === 'talk_to') {
        const actorFaction = getCharFaction(result.characterId);
        const targetId = (result.action as any).args?.target as string | undefined;
        if (targetId && actorFaction) {
          const targetFaction = getCharFaction(targetId);
          if (targetFaction && targetFaction === actorFaction) {
            hMetrics.intraFactionTalks++;
          }
        }
      }
    } else if (result.action.type === 'dialogue') {
      sMetrics.dialogueCount++;
    } else {
      sMetrics.idleCount++;
    }

    // Track order-driven initiatives
    if (result.trigger?.reason === 'hierarchy_order') {
      hMetrics.orderInitiatives++;
    }
  });

  engine.events.on('agent:error', () => { sMetrics.errorCount++; });
  engine.events.on('proximity:tierChanged', () => { sMetrics.tierChanges++; });
  engine.events.on('memory:created', () => { sMetrics.memoriesCreated++; });
  engine.events.on('tick:fast', () => { sMetrics.ticksFast++; });
  engine.events.on('tick:slow', () => { sMetrics.ticksSlow++; });

  // ── Event Wiring: Hierarchy ─────────────────────────────────

  engine.events.on('hierarchy:rankChanged', (characterId: string, factionId: string, oldRank: number, newRank: number) => {
    // Only count promotions/demotions for characters already in the faction (oldRank >= 0)
    // Initial rank assignments have oldRank = -1
    if (oldRank < 0) return;
    if (newRank < oldRank) {
      hMetrics.promotions++;
    } else if (newRank > oldRank) {
      hMetrics.demotions++;
    }
  });

  engine.events.on('hierarchy:orderIssued', (from: string, to: string, factionId: string) => {
    hMetrics.ordersIssued++;
    hMetrics.ordersByFaction[factionId] = (hMetrics.ordersByFaction[factionId] ?? 0) + 1;
  });

  engine.events.on('hierarchy:succession', (factionId: string, promotedId: string, toRank: number) => {
    hMetrics.successionEvents++;
    hMetrics.successionDetails.push({
      factionId,
      promotedId,
      toRank,
      timestamp: Date.now(),
    });
  });

  // Track leaders with additive updates — add on promotion to rank 0, remove on death
  const knownLeaders = new Set<string>();
  // Seed from initial state
  for (const factionId of ['acme_corp', 'shadow_guild']) {
    for (const m of engine.getFactionMembers(factionId)) {
      if (m.rankLevel === 0) knownLeaders.add(m.characterId);
    }
  }

  engine.events.on('hierarchy:rankChanged', (characterId: string, _factionId: string, _oldRank: number, newRank: number) => {
    if (newRank === 0) knownLeaders.add(characterId);
  });

  engine.events.on('character:died', (characterId: string) => {
    hMetrics.totalDeaths++;
    if (knownLeaders.has(characterId)) {
      hMetrics.leaderDeaths++;
      knownLeaders.delete(characterId);
    }
  });

  // ── Load Plugin ─────────────────────────────────────────────

  await engine.loadPlugin(createHierarchyPlugin());

  // ── Post-Plugin Setup: Assign Ranks ─────────────────────────

  const allChars = engine.getAllCharacters();

  // Assign Acme Corp ranks
  const acmeChars = allChars.filter(c => characterFactions.get(c.id) === 'acme_corp');
  let idx = 0;
  for (const c of acmeChars) {
    let rank: number;
    if (idx < r0) rank = 0;
    else if (idx < r0 + r1) rank = 1;
    else if (idx < r0 + r1 + r2) rank = 2;
    else rank = 3;
    engine.setCharacterRank(c.id, 'acme_corp', rank);
    idx++;
  }

  // Assign Shadow Guild ranks
  const guildChars = allChars.filter(c => characterFactions.get(c.id) === 'shadow_guild');
  idx = 0;
  for (const c of guildChars) {
    let rank: number;
    if (idx < r0) rank = 0;
    else if (idx < r0 + r1) rank = 1;
    else if (idx < r0 + r1 + r2) rank = 2;
    else rank = 3;
    engine.setCharacterRank(c.id, 'shadow_guild', rank);
    idx++;
  }

  // Set intra-faction relationships (same-faction members are friendly)
  for (const faction of ['acme_corp', 'shadow_guild'] as const) {
    const members = allChars.filter(c => characterFactions.get(c.id) === faction);
    for (let i = 0; i < Math.min(members.length, 6); i++) {
      for (let j = i + 1; j < Math.min(members.length, 6); j++) {
        engine.setRelationship(members[i].id, members[j].id, { type: 'ally', strength: 60, trust: 50 });
        engine.setRelationship(members[j].id, members[i].id, { type: 'ally', strength: 60, trust: 50 });
      }
    }
  }

  // Cross-faction rivalry for leaders
  if (acmeChars.length > 0 && guildChars.length > 0) {
    engine.setRelationship(acmeChars[0].id, guildChars[0].id, { type: 'rival', strength: 30, trust: 10 });
    engine.setRelationship(guildChars[0].id, acmeChars[0].id, { type: 'rival', strength: 30, trust: 10 });
  }

  // Set initial world facts
  engine.setWorldFact('weather', 'clear', 'global', 'system');
  engine.setWorldFact('faction_war', 'cold_war', 'global', 'system');

  // Set initial goals
  for (const c of allChars) {
    engine.addGoal(c.id, randomFrom(GOALS_POOL), Math.floor(Math.random() * 5) + 5, [
      { description: 'Prepare', completed: false },
      { description: 'Execute', completed: false },
    ]);
    const goals = engine.goals.getActiveGoals(c.id);
    if (goals.length > 0) engine.goals.activateGoal(goals[0].id);
  }

  // ── Health Check ────────────────────────────────────────────

  const health = await engine.healthCheck();
  if (!health.inference) {
    console.log(`ERROR: Inference provider not available at ${inferenceConfig.baseUrl}`);
    await engine.stop();
    return;
  }
  console.log(`  ${inferenceConfig.type} connected. Starting simulation...\n`);

  // Print faction roster summary
  const acmeMembers = engine.getFactionMembers('acme_corp');
  const guildMembers = engine.getFactionMembers('shadow_guild');
  console.log(`  Acme Corp:     ${acmeMembers.length} members`);
  for (let rank = 0; rank <= 3; rank++) {
    const atRank = acmeMembers.filter(m => m.rankLevel === rank);
    const rankName = engine.hierarchy.getRankName('acme_corp', rank);
    const names = atRank.map(m => engine.getCharacter(m.characterId)?.name ?? m.characterId);
    console.log(`    ${rankName}(${rank}): ${names.join(', ')}`);
  }
  console.log(`  Shadow Guild:  ${guildMembers.length} members`);
  for (let rank = 0; rank <= 3; rank++) {
    const atRank = guildMembers.filter(m => m.rankLevel === rank);
    const rankName = engine.hierarchy.getRankName('shadow_guild', rank);
    const names = atRank.map(m => engine.getCharacter(m.characterId)?.name ?? m.characterId);
    console.log(`    ${rankName}(${rank}): ${names.join(', ')}`);
  }
  console.log('');

  // ── Phase tracking ──────────────────────────────────────────

  let currentPhase: Phase = 'warmup';
  let phaseDecisionsAtStart = 0;
  let lastPhaseNumber = -1;

  function startPhaseTracking(phase: Phase) {
    hMetrics.phaseTimings[phase] = {
      startMs: Date.now(),
      endMs: 0,
      decisions: 0,
    };
    phaseDecisionsAtStart = sMetrics.totalDecisions;
  }

  function endPhaseTracking(phase: Phase) {
    const timing = hMetrics.phaseTimings[phase];
    if (timing) {
      timing.endMs = Date.now();
      timing.decisions = sMetrics.totalDecisions - phaseDecisionsAtStart;
    }
  }

  // ── Succession tracking ─────────────────────────────────────

  let successionLeader1Killed = false;
  let successionLeader2Killed = false;
  let successionCascadeKilled = false;
  let successionCascadeTickTarget = PHASE_TICKS * 2 + Math.floor(PHASE_TICKS / 2); // mid-phase 3

  // ── Start Engine ────────────────────────────────────────────

  const simStart = Date.now();
  engine.start();

  // ── Event injection loop ────────────────────────────────────

  const eventTimer = setInterval(async () => {
    const ev = randomEvent();
    sMetrics.eventsInjected++;
    try {
      await engine.injectEvent(ev);
    } catch {}
  }, EVENT_INTERVAL_MS);

  // ── Phase 2: Order injection loop ───────────────────────────

  let orderTimer: ReturnType<typeof setInterval> | null = null;

  function startOrderInjection() {
    if (orderTimer) return;
    orderTimer = setInterval(() => {
      // Acme CEO issues orders
      const acmeLeaderMem = engine.getFactionMembers('acme_corp').find(m => m.rankLevel === 0);
      if (acmeLeaderMem) {
        const acmeSubs = engine.getSubordinates(acmeLeaderMem.characterId, 'acme_corp');
        if (acmeSubs.length > 0) {
          const target = randomFrom(acmeSubs);
          const instruction = randomFrom(ACME_ORDERS);
          engine.issueHierarchyOrder(acmeLeaderMem.characterId, target.characterId, 'acme_corp', instruction, 'work');
        }
      }

      // Guild Guildmaster issues orders
      const guildLeaderMem = engine.getFactionMembers('shadow_guild').find(m => m.rankLevel === 0);
      if (guildLeaderMem) {
        const guildSubs = engine.getSubordinates(guildLeaderMem.characterId, 'shadow_guild');
        if (guildSubs.length > 0) {
          const target = randomFrom(guildSubs);
          const instruction = randomFrom(GUILD_ORDERS);
          engine.issueHierarchyOrder(guildLeaderMem.characterId, target.characterId, 'shadow_guild', instruction, 'mission');
        }
      }
    }, 2000);
  }

  function stopOrderInjection() {
    if (orderTimer) {
      clearInterval(orderTimer);
      orderTimer = null;
    }
  }

  // ── Phase 4: Warfare injection loop ─────────────────────────

  let warfareTimer: ReturnType<typeof setInterval> | null = null;

  function startWarfare() {
    if (warfareTimer) return;
    warfareTimer = setInterval(async () => {
      // High-frequency cross-faction combat events
      const acmeFighters = engine.getFactionMembers('acme_corp');
      const guildFighters = engine.getFactionMembers('shadow_guild');

      if (acmeFighters.length > 0 && guildFighters.length > 0) {
        const attacker = randomFrom(acmeFighters);
        const defender = randomFrom(guildFighters);
        const loc = randomFrom(LOCATIONS);

        await engine.injectEvent({
          type: 'cross_faction_combat',
          source: attacker.characterId,
          target: defender.characterId,
          data: {
            location: loc,
            detail: `Cross-faction battle between Acme Corp and Shadow Guild at ${loc}!`,
            factions: ['acme_corp', 'shadow_guild'],
          },
          importance: 8,
          timestamp: Date.now(),
        }).catch(() => {});

        sMetrics.eventsInjected++;
      }

      // Leaders issue fight orders against opposing faction
      const acmeLeader = engine.getFactionMembers('acme_corp').find(m => m.rankLevel === 0);
      if (acmeLeader) {
        const subs = engine.getSubordinates(acmeLeader.characterId, 'acme_corp');
        if (subs.length > 0) {
          const target = randomFrom(subs);
          engine.issueHierarchyOrder(
            acmeLeader.characterId, target.characterId, 'acme_corp',
            'Fight any Shadow Guild member you encounter!', 'combat',
          );
        }
      }

      const guildLeader = engine.getFactionMembers('shadow_guild').find(m => m.rankLevel === 0);
      if (guildLeader) {
        const subs = engine.getSubordinates(guildLeader.characterId, 'shadow_guild');
        if (subs.length > 0) {
          const target = randomFrom(subs);
          engine.issueHierarchyOrder(
            guildLeader.characterId, target.characterId, 'shadow_guild',
            'Attack any Acme Corp agent you see!', 'combat',
          );
        }
      }

      // Promote random combat participants
      if (Math.random() < 0.3) {
        const factionId = Math.random() < 0.5 ? 'acme_corp' : 'shadow_guild';
        const members = engine.getFactionMembers(factionId).filter(m => m.rankLevel > 0);
        if (members.length > 0) {
          const candidate = randomFrom(members);
          const promoted = engine.promoteCharacter(candidate.characterId, factionId);
          if (promoted) {
            const char = engine.getCharacter(candidate.characterId);
            const fName = factionId === 'acme_corp' ? 'Acme' : 'Guild';
            console.log(`  [WARFARE PROMO] ${char?.name ?? candidate.characterId} promoted in ${fName}`);
          }
        }
      }
    }, 1500);
  }

  function stopWarfare() {
    if (warfareTimer) {
      clearInterval(warfareTimer);
      warfareTimer = null;
    }
  }

  // ── Progress display ────────────────────────────────────────

  const progressTimer = setInterval(() => {
    const elapsed = ((Date.now() - simStart) / 1000).toFixed(1);
    const phase = getPhase(sMetrics.ticksFast);
    const phaseNum = getPhaseNumber(sMetrics.ticksFast) + 1;
    const toolTotal = Object.values(sMetrics.toolCalls).reduce((a, b) => a + b, 0);
    const totalActs = sMetrics.totalDecisions || 1;
    const toolPct = ((toolTotal / totalActs) * 100).toFixed(0);

    process.stdout.write(
      `\r  [${elapsed}s] Phase ${phaseNum}/${PHASE_SEQUENCE.length} (${phase}) | Ticks: ${sMetrics.ticksFast}/${totalTicks} | Dec: ${sMetrics.totalDecisions} | Tools: ${toolPct}% | Orders: ${hMetrics.ordersIssued} | Promo: ${hMetrics.promotions} | Succ: ${hMetrics.successionEvents} | Deaths: ${hMetrics.totalDeaths} | Err: ${sMetrics.errorCount}  `,
    );
  }, 500);

  // ── Main tick loop with phase transitions ───────────────────

  startPhaseTracking('warmup');
  console.log('  >>> Phase 1: WARM-UP — baseline with hierarchy prompts');

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      const tickCount = sMetrics.ticksFast;
      const phaseNum = getPhaseNumber(tickCount);

      // Phase transitions
      if (phaseNum !== lastPhaseNumber) {
        // End previous phase
        if (lastPhaseNumber >= 0 && lastPhaseNumber < PHASE_SEQUENCE.length) {
          endPhaseTracking(PHASE_SEQUENCE[lastPhaseNumber]);
          // Cleanup previous phase
          if (PHASE_SEQUENCE[lastPhaseNumber] === 'orders') stopOrderInjection();
          if (PHASE_SEQUENCE[lastPhaseNumber] === 'warfare') stopWarfare();
        }

        lastPhaseNumber = phaseNum;
        currentPhase = PHASE_SEQUENCE[phaseNum] ?? 'warfare';
        startPhaseTracking(currentPhase);

        // Start new phase
        if (currentPhase === 'orders') {
          console.log('\n  >>> Phase 2: ORDERS — leaders issue commands to subordinates');
          startOrderInjection();
        } else if (currentPhase === 'succession') {
          console.log('\n  >>> Phase 3: SUCCESSION — killing leaders, testing auto-promotion');
          stopOrderInjection();

          // Kill both faction leaders at phase start
          const acmeLeader = engine.getFactionMembers('acme_corp').find(m => m.rankLevel === 0);
          const guildLeader = engine.getFactionMembers('shadow_guild').find(m => m.rankLevel === 0);

          if (acmeLeader && !successionLeader1Killed) {
            const char = engine.getCharacter(acmeLeader.characterId);
            console.log(`  [KILL] Acme Corp CEO ${char?.name ?? acmeLeader.characterId}`);
            engine.killCharacter(acmeLeader.characterId, 'assassination');
            successionLeader1Killed = true;
          }

          if (guildLeader && !successionLeader2Killed) {
            const char = engine.getCharacter(guildLeader.characterId);
            console.log(`  [KILL] Shadow Guild Guildmaster ${char?.name ?? guildLeader.characterId}`);
            engine.killCharacter(guildLeader.characterId, 'poisoned');
            successionLeader2Killed = true;
          }
        } else if (currentPhase === 'warfare') {
          console.log('\n  >>> Phase 4: WARFARE — cross-faction combat, battlefield promotions');
          startWarfare();
        }
      }

      // Mid-phase 3: cascading succession (kill replacement leaders)
      if (currentPhase === 'succession' && tickCount >= successionCascadeTickTarget && !successionCascadeKilled) {
        successionCascadeKilled = true;
        const newAcmeLeader = engine.getFactionMembers('acme_corp').find(m => m.rankLevel === 0);
        const newGuildLeader = engine.getFactionMembers('shadow_guild').find(m => m.rankLevel === 0);

        if (newAcmeLeader) {
          const char = engine.getCharacter(newAcmeLeader.characterId);
          console.log(`\n  [CASCADE KILL] New Acme CEO ${char?.name ?? newAcmeLeader.characterId}`);
          engine.killCharacter(newAcmeLeader.characterId, 'ambush');
        }
        if (newGuildLeader) {
          const char = engine.getCharacter(newGuildLeader.characterId);
          console.log(`  [CASCADE KILL] New Guildmaster ${char?.name ?? newGuildLeader.characterId}`);
          engine.killCharacter(newGuildLeader.characterId, 'betrayal');
        }
      }

      // Check if we've reached all ticks
      if (tickCount >= totalTicks) {
        clearInterval(check);
        resolve();
      }
    }, 200);
  });

  // ── Cleanup ─────────────────────────────────────────────────

  // End the final phase
  endPhaseTracking(currentPhase);
  stopOrderInjection();
  stopWarfare();
  clearInterval(eventTimer);
  clearInterval(progressTimer);
  console.log('\n');

  // ── Gather final state ──────────────────────────────────────

  const finalAcmeMembers = engine.getFactionMembers('acme_corp');
  const finalGuildMembers = engine.getFactionMembers('shadow_guild');
  const finalAcmeLeader = finalAcmeMembers.find(m => m.rankLevel === 0);
  const finalGuildLeader = finalGuildMembers.find(m => m.rankLevel === 0);

  // Rank distribution
  function getRankDist(members: Array<{ rankLevel: number }>): Record<number, number> {
    const dist: Record<number, number> = {};
    for (const m of members) dist[m.rankLevel] = (dist[m.rankLevel] ?? 0) + 1;
    return dist;
  }

  const acmeRankDist = getRankDist(finalAcmeMembers);
  const guildRankDist = getRankDist(finalGuildMembers);

  const deathRecords = engine.getDeathRecords();

  // Stop engine
  await engine.stop();

  // ── Report ──────────────────────────────────────────────────

  const simDuration = (Date.now() - simStart) / 1000;
  const throughput = sMetrics.totalDecisions / simDuration;
  const p50 = percentile(sMetrics.latencies, 50);
  const p95 = percentile(sMetrics.latencies, 95);
  const p99 = percentile(sMetrics.latencies, 99);
  const avgLatency = sMetrics.latencies.length > 0
    ? sMetrics.latencies.reduce((a, b) => a + b, 0) / sMetrics.latencies.length
    : 0;

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      RESULTS                               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  STANDARD METRICS');
  console.log(`║  Duration:           ${simDuration.toFixed(1)}s`);
  console.log(`║  Fast ticks:         ${sMetrics.ticksFast}`);
  console.log(`║  Slow ticks:         ${sMetrics.ticksSlow}`);
  console.log(`║  Total decisions:    ${sMetrics.totalDecisions}`);
  console.log(`║  Throughput:         ${throughput.toFixed(2)} decisions/sec`);
  console.log(`║  Total tokens:       ${sMetrics.totalTokens}`);
  console.log(`║  Tokens/sec:         ${(sMetrics.totalTokens / simDuration).toFixed(0)}`);
  console.log(`║  Avg latency:        ${avgLatency.toFixed(0)}ms`);
  console.log(`║  p50 latency:        ${p50.toFixed(0)}ms`);
  console.log(`║  p95 latency:        ${p95.toFixed(0)}ms`);
  console.log(`║  p99 latency:        ${p99.toFixed(0)}ms`);
  console.log(`║  Errors:             ${sMetrics.errorCount}`);
  console.log(`║  Events injected:    ${sMetrics.eventsInjected}`);
  console.log(`║  Embeddings:         ${USE_EMBEDDINGS ? 'enabled' : 'disabled'}`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  ACTION BREAKDOWN');
  const totalActions = sMetrics.totalDecisions || 1;
  for (const [tool, count] of Object.entries(sMetrics.toolCalls).sort((a, b) => b[1] - a[1])) {
    console.log(`║    ${tool}: ${count} (${((count / totalActions) * 100).toFixed(1)}%)`);
  }
  console.log(`║    dialogue: ${sMetrics.dialogueCount} (${((sMetrics.dialogueCount / totalActions) * 100).toFixed(1)}%)`);
  console.log(`║    idle: ${sMetrics.idleCount} (${((sMetrics.idleCount / totalActions) * 100).toFixed(1)}%)`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  HIERARCHY METRICS');
  console.log(`║  Orders issued:      ${hMetrics.ordersIssued}`);
  for (const [faction, count] of Object.entries(hMetrics.ordersByFaction)) {
    const fName = faction === 'acme_corp' ? 'Acme Corp' : 'Shadow Guild';
    console.log(`║    ${fName}: ${count}`);
  }
  console.log(`║  Order initiatives:  ${hMetrics.orderInitiatives}`);
  console.log(`║  Promotions:         ${hMetrics.promotions}`);
  console.log(`║  Demotions:          ${hMetrics.demotions}`);
  console.log(`║  Succession events:  ${hMetrics.successionEvents}`);
  for (const detail of hMetrics.successionDetails) {
    const fName = detail.factionId === 'acme_corp' ? 'Acme' : 'Guild';
    const elapsed = ((detail.timestamp - simStart) / 1000).toFixed(1);
    console.log(`║    [${elapsed}s] ${fName} rank ${detail.toRank} ← ${detail.promotedId}`);
  }
  console.log(`║  Leader deaths:      ${hMetrics.leaderDeaths}`);
  console.log(`║  Total deaths:       ${hMetrics.totalDeaths}`);
  console.log(`║  Cross-faction fights: ${hMetrics.crossFactionFights}`);
  console.log(`║  Intra-faction talks:  ${hMetrics.intraFactionTalks}`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  PHASE BREAKDOWN');
  for (const phase of PHASE_SEQUENCE) {
    const timing = hMetrics.phaseTimings[phase];
    if (timing && timing.endMs > 0) {
      const dur = ((timing.endMs - timing.startMs) / 1000).toFixed(1);
      console.log(`║    ${phase.padEnd(12)} ${dur}s  ${timing.decisions} decisions`);
    } else if (timing) {
      console.log(`║    ${phase.padEnd(12)} (incomplete)`);
    }
  }
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  FINAL FACTION STATUS');
  console.log('║');
  console.log(`║  Acme Corp: ${finalAcmeMembers.length} members`);
  if (finalAcmeLeader) {
    const leaderChar = engine.getCharacter(finalAcmeLeader.characterId);
    console.log(`║    Current CEO: ${leaderChar?.name ?? finalAcmeLeader.characterId}`);
  } else {
    console.log('║    Current CEO: (none — vacant!)');
  }
  console.log(`║    Rank distribution: ${Object.entries(acmeRankDist).map(([r, c]) => `${engine.hierarchy.getRankName('acme_corp', parseInt(r))}=${c}`).join(', ')}`);
  console.log('║');
  console.log(`║  Shadow Guild: ${finalGuildMembers.length} members`);
  if (finalGuildLeader) {
    const leaderChar = engine.getCharacter(finalGuildLeader.characterId);
    console.log(`║    Current Guildmaster: ${leaderChar?.name ?? finalGuildLeader.characterId}`);
  } else {
    console.log('║    Current Guildmaster: (none — vacant!)');
  }
  console.log(`║    Rank distribution: ${Object.entries(guildRankDist).map(([r, c]) => `${engine.hierarchy.getRankName('shadow_guild', parseInt(r))}=${c}`).join(', ')}`);
  console.log('║');
  console.log(`║  Death records: ${deathRecords.length}`);
  for (const d of deathRecords) {
    const elapsed = ((d.timestamp - simStart) / 1000).toFixed(1);
    const faction = characterFactions.get(d.characterId) ?? '?';
    const fName = faction === 'acme_corp' ? 'Acme' : faction === 'shadow_guild' ? 'Guild' : '?';
    console.log(`║    [${elapsed}s] ${d.characterName} (${fName}) — ${d.cause}${d.replacedBy ? ` → replaced by ${d.replacedBy}` : ''}`);
  }
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ── Summary verdict ─────────────────────────────────────────

  console.log('');
  const pass = sMetrics.errorCount === 0
    && sMetrics.totalDecisions > 0
    && hMetrics.successionEvents > 0;
  if (pass) {
    console.log(`  PASS: ${sMetrics.totalDecisions} decisions, ${sMetrics.errorCount} errors, ${hMetrics.successionEvents} successions, ${hMetrics.ordersIssued} orders`);
  } else {
    console.log(`  ISSUES DETECTED:`);
    if (sMetrics.errorCount > 0) console.log(`    - ${sMetrics.errorCount} errors occurred`);
    if (sMetrics.totalDecisions === 0) console.log('    - No decisions were made');
    if (hMetrics.successionEvents === 0) console.log('    - No succession events fired');
  }
}

main().catch(console.error);
