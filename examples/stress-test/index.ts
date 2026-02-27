/**
 * Stress-Test Simulation Harness
 *
 * Runs the engine at maximum speed without choking LM Studio.
 * - Configurable character count, tick rates, simulation duration
 * - Measures throughput, latency, token usage, error rates
 * - Simulates game events at configurable frequency
 * - Reports detailed metrics at the end
 *
 * Usage:
 *   npx tsx examples/stress-test/index.ts
 *   npx tsx examples/stress-test/index.ts --chars=8 --ticks=20 --fast-ms=1000
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
} from '../../src/index';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';

// ── CLI args ─────────────────────────────────────────────────

function getArg(name: string, defaultVal: number): number {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : defaultVal;
}

const NUM_CHARS = getArg('chars', 6);
const TARGET_FAST_TICKS = getArg('ticks', 15);
const FAST_TICK_MS = getArg('fast-ms', 800);
const SLOW_TICK_MS = getArg('slow-ms', 8000);
const BATCH_SIZE = getArg('batch', 6);
const MAX_CONCURRENCY = getArg('concurrency', 8);
const EVENT_INTERVAL_MS = getArg('event-ms', 3000);
const EMBED_URL = process.argv.find(a => a.startsWith('--embed-url='))?.split('=')[1] ?? 'http://172.18.64.1:1234/v1';
const EMBED_MODEL = process.argv.find(a => a.startsWith('--embed-model='))?.split('=')[1] ?? 'text-embedding-nomic-embed-text-v2-moe@q8_0';
const USE_EMBEDDINGS = process.argv.includes('--embeddings');

// ── Metrics ──────────────────────────────────────────────────

interface Metrics {
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
  memoriesPruned: number;
  eventsInjected: number;
  ticksFast: number;
  ticksSlow: number;
  semanticRetrievals: number;
  memoryConsolidations: number;
}

const metrics: Metrics = {
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
  memoriesPruned: 0,
  eventsInjected: 0,
  ticksFast: 0,
  ticksSlow: 0,
  semanticRetrievals: 0,
  memoryConsolidations: 0,
};

// ── World Simulation ─────────────────────────────────────────

const LOCATIONS = ['town_square', 'marketplace', 'tavern', 'docks', 'temple', 'barracks', 'forest_edge', 'castle_gate'];
const EVENT_TYPES = ['trade', 'combat', 'dialogue', 'discovery', 'quest_start', 'meeting', 'conflict', 'gift', 'alliance', 'routine'];
const NAMES = ['Aldric', 'Brynn', 'Cassandra', 'Drake', 'Elira', 'Fenwick', 'Gwen', 'Hadrian', 'Isolde', 'Jasper', 'Kira', 'Lucan'];
const ARCHETYPES = ['warrior', 'merchant', 'scholar', 'rogue', 'healer', 'smith'];
const TRAITS_POOL = ['brave', 'cunning', 'kind', 'greedy', 'loyal', 'suspicious', 'creative', 'stubborn', 'patient', 'impulsive', 'wise', 'naive'];
const GOALS_POOL = [
  'Protect the village', 'Find rare artifacts', 'Build a trade empire', 'Uncover ancient secrets',
  'Seek revenge', 'Find a lost friend', 'Earn the king\'s favor', 'Master a craft',
  'Explore unknown lands', 'Heal the sick', 'Defeat the bandits', 'Write a great book',
];

const worldState = {
  time: 0,
  weather: 'clear' as string,
  tension: 50,
  charLocations: new Map<string, string>(),
};

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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

// ── Plugin ───────────────────────────────────────────────────

function createStressPlugin(): GamePlugin {
  return {
    id: 'stress-test',
    name: 'Stress Test World',

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
      for (let i = 0; i < NUM_CHARS; i++) {
        const name = NAMES[i % NAMES.length];
        const archetype = ARCHETYPES[i % ARCHETYPES.length];
        const closeness = Math.floor(Math.random() * 80) + 5;
        const loc = randomFrom(LOCATIONS);
        worldState.charLocations.set(`char-${i}`, loc);

        chars.push({
          id: `char-${i}`,
          name: `${name}`,
          archetype,
          identity: {
            personality: `${randomFrom(TRAITS_POOL)} and ${randomFrom(TRAITS_POOL)}. Known for being a strong ${archetype}.`,
            backstory: `${name} grew up near ${loc}. After years of ${archetype} work, they seek something more.`,
            goals: [randomFrom(GOALS_POOL), randomFrom(GOALS_POOL)],
            traits: [randomFrom(TRAITS_POOL), randomFrom(TRAITS_POOL), randomFrom(TRAITS_POOL)],
            speechStyle: `Speaks like a ${archetype}. Direct and practical.`,
          },
          initialCloseness: closeness,
        });
      }
      return chars;
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
            const loc = args.location as string;
            return { success: true, result: `Moved to ${loc}` };
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
            description: 'Attack or defend',
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
        recentEvents: [`World tension: ${worldState.tension}`, `Weather: ${worldState.weather}`],
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
      return 'Medieval fantasy world. Characters make one action per turn. Be concise. Use tools when appropriate.';
    },

    getEventTypes(): string[] {
      return EVENT_TYPES;
    },

    onFastTick(timestamp: number) {
      worldState.time++;
      // Rotate weather occasionally
      if (worldState.time % 10 === 0) {
        worldState.weather = randomFrom(['clear', 'cloudy', 'rainy', 'foggy', 'stormy']);
      }
      // Drift tension
      worldState.tension = Math.max(0, Math.min(100,
        worldState.tension + (Math.random() - 0.5) * 10,
      ));
    },
  };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║         AI Character Engine - Stress Test        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Characters: ${NUM_CHARS}`);
  console.log(`  Target fast ticks: ${TARGET_FAST_TICKS}`);
  console.log(`  Fast tick: ${FAST_TICK_MS}ms, Slow tick: ${SLOW_TICK_MS}ms`);
  console.log(`  Batch size: ${BATCH_SIZE}, Max concurrency: ${MAX_CONCURRENCY}`);
  console.log(`  Event injection every: ${EVENT_INTERVAL_MS}ms`);
  console.log(`  Embeddings: ${USE_EMBEDDINGS ? `enabled (${EMBED_URL})` : 'disabled (use --embeddings to enable)'}`);
  console.log('');

  // Clean previous test DB
  const fs = await import('fs');
  try { fs.unlinkSync('./data/stress-test.db'); } catch {}
  try { fs.unlinkSync('./data/stress-test.db-wal'); } catch {}
  try { fs.unlinkSync('./data/stress-test.db-shm'); } catch {}

  // Choose provider: 'vllm' for vLLM (high throughput), 'lmstudio' for LM Studio
  const USE_VLLM = process.argv.includes('--vllm') || !process.argv.includes('--lmstudio');
  const VLLM_PORT = getArg('port', 8100);

  // Auto-detect model name from vLLM /v1/models endpoint
  let vllmModelName = 'Qwen2.5-7B-Instruct-Uncensored_Q4_K_M.gguf';
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
        models: {
          heavy: vllmModelName,
          mid: vllmModelName,
          light: vllmModelName,
        },
        maxConcurrency: 32,
        timeoutMs: 60000,
      }
    : {
        type: 'lmstudio' as const,
        baseUrl: 'http://192.168.1.136:1234/v1',
        models: {
          heavy: 'qwen2.5-7b-instruct-uncensored',
          mid: 'qwen2.5-7b-instruct-uncensored',
          light: 'qwen2.5-7b-instruct-uncensored',
        },
        maxConcurrency: MAX_CONCURRENCY,
        timeoutMs: 45000,
      };

  console.log(`  Provider: ${inferenceConfig.type} @ ${inferenceConfig.baseUrl}`);
  console.log(`  Model: ${USE_VLLM ? vllmModelName : 'qwen2.5-7b-instruct-uncensored'}`);
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
    database: { path: './data/stress-test.db' },
    inference: inferenceConfig,
    ...embeddingConfig,
    tick: {
      fastTickMs: FAST_TICK_MS,
      slowTickMs: SLOW_TICK_MS,
      maxAgentsPerFastTick: NUM_CHARS,
      maxAgentsPerSlowTick: NUM_CHARS,
      batchSize: BATCH_SIZE,
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

  // Wire metrics collection
  engine.events.on('agent:decision', (result: AgentDecisionResult) => {
    metrics.totalDecisions++;
    metrics.totalTokens += result.tokensUsed;
    metrics.totalDurationMs += result.durationMs;
    metrics.latencies.push(result.durationMs);

    if ('toolName' in result.action) {
      const name = (result.action as any).toolName;
      metrics.toolCalls[name] = (metrics.toolCalls[name] ?? 0) + 1;
    } else if (result.action.type === 'dialogue') {
      metrics.dialogueCount++;
    } else {
      metrics.idleCount++;
    }
  });

  engine.events.on('agent:error', () => { metrics.errorCount++; });
  engine.events.on('proximity:tierChanged', () => { metrics.tierChanges++; });
  engine.events.on('memory:created', () => { metrics.memoriesCreated++; });
  engine.events.on('memory:pruned', (_, count) => { metrics.memoriesPruned += count; });
  engine.events.on('tick:fast', () => { metrics.ticksFast++; });
  engine.events.on('tick:slow', () => { metrics.ticksSlow++; });

  // Load plugin
  await engine.loadPlugin(createStressPlugin());

  // Health check
  const health = await engine.healthCheck();
  if (!health.inference) {
    console.log(`ERROR: Inference provider not available at ${inferenceConfig.baseUrl}`);
    await engine.stop();
    return;
  }
  console.log(`${inferenceConfig.type} connected. Starting simulation...\n`);

  // Print character roster
  const chars = engine.getAllCharacters();
  for (const c of chars) {
    const prox = engine.getCloseness(c.id);
    console.log(`  ${c.name} (${c.archetype}) closeness=${prox?.closeness ?? 0} tier=${c.activityTier}`);
  }
  console.log('');

  // ── Set up expansion subsystems ──────────────────────────────

  // Set initial world state
  engine.setWorldFact('weather', 'clear', 'global', 'system');
  engine.setWorldFact('time_of_day', 'morning', 'global', 'system');
  engine.setWorldFact('market_status', 'open', 'location', 'system');

  // Set initial character goals
  for (const c of chars) {
    const goalDesc = randomFrom(GOALS_POOL);
    engine.addGoal(c.id, goalDesc, Math.floor(Math.random() * 5) + 5, [
      { description: `Prepare for: ${goalDesc}`, completed: false },
      { description: `Execute: ${goalDesc}`, completed: false },
    ]);
    engine.goals.activateGoal(engine.goals.getActiveGoals(c.id)[0]?.id ?? '');
  }

  // Create a character group
  if (chars.length >= 3) {
    const groupMembers = chars.slice(0, 3).map(c => c.id);
    engine.createGroup('The Alliance', groupMembers, 'Defend the village together');
  }

  // Set some initial relationships
  if (chars.length >= 2) {
    engine.setRelationship(chars[0].id, chars[1].id, { type: 'friend', strength: 75 });
    engine.setRelationship(chars[1].id, chars[0].id, { type: 'friend', strength: 70 });
    if (chars.length >= 3) {
      engine.setRelationship(chars[0].id, chars[2].id, { type: 'rival', strength: 25 });
    }
  }

  console.log('  Expansion systems initialized:');
  console.log(`    World facts: ${engine.worldState.size}`);
  console.log(`    Character goals: ${chars.length} characters with goals`);
  console.log(`    Groups: ${engine.groups.getAll().length}`);
  console.log('');

  // Start engine
  const simStart = Date.now();
  engine.start();

  // Inject events periodically
  const eventTimer = setInterval(async () => {
    const ev = randomEvent();
    metrics.eventsInjected++;
    try {
      await engine.injectEvent(ev);
    } catch {}
  }, EVENT_INTERVAL_MS);

  // Live progress
  const progressTimer = setInterval(() => {
    const elapsed = ((Date.now() - simStart) / 1000).toFixed(1);
    const avgLatency = metrics.latencies.length > 0
      ? (metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length).toFixed(0)
      : '0';
    const toolTotal = Object.values(metrics.toolCalls).reduce((a, b) => a + b, 0);
    const totalActs = metrics.totalDecisions || 1;
    const toolPct = ((toolTotal / totalActs) * 100).toFixed(0);

    // Expansion metrics
    const allChars = engine.getAllCharacters();
    const emotionCount = allChars.reduce((sum, c) => sum + engine.emotions.getEmotions(c.id).active.length, 0);
    const goalSteps = allChars.reduce((sum, c) => {
      const goals = engine.goals.getActiveGoals(c.id);
      return sum + goals.reduce((gs, g) => gs + g.steps.filter((s: any) => s.completed).length, 0);
    }, 0);
    const worldFacts = engine.worldState.size;
    const groupCount = engine.groups.getAll().length;

    process.stdout.write(
      `\r  [${elapsed}s] Ticks: ${metrics.ticksFast}/${TARGET_FAST_TICKS} | Dec: ${metrics.totalDecisions} | Tools: ${toolPct}% | Emo: ${emotionCount} | Goals: ${goalSteps}done | Facts: ${worldFacts} | Groups: ${groupCount} | Err: ${metrics.errorCount}  `,
    );
  }, 500);

  // Wait for target ticks
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (metrics.ticksFast >= TARGET_FAST_TICKS) {
        clearInterval(check);
        resolve();
      }
    }, 200);
  });

  // Gather report data BEFORE stopping (need DB open)
  clearInterval(eventTimer);
  clearInterval(progressTimer);
  console.log('\n');

  const finalChars = engine.getAllCharacters().map(c => ({
    ...c,
    prox: engine.getCloseness(c.id),
    mood: engine.emotions.getMood(c.id),
    goals: engine.goals.getActiveGoals(c.id).length,
    rels: engine.relationships.getRelationships(c.id).filter((r: any) => r.type !== 'neutral').length,
  }));
  const worldFactCount = engine.worldState.size;
  const groupCount = engine.groups.getAll().length;
  const playerProfile = engine.playerModeler.getProfile('default');

  // Exercise decision log queries
  const decisionCount = engine.countDecisions();
  const recentDecisions = engine.queryDecisions({ limit: 3 });

  // Exercise introspection on first character
  const introspection = chars.length > 0 ? engine.getCharacterIntrospection(chars[0].id) : null;

  // Exercise state export before stop (persistence round-trip)
  const exportedState = engine.exportState();

  // Now stop (auto-saves state)
  await engine.stop();

  // ── Report ────────────────────────────────────────────────
  const simDuration = (Date.now() - simStart) / 1000;
  const avgLatency = metrics.latencies.length > 0
    ? metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length
    : 0;
  const p50 = percentile(metrics.latencies, 50);
  const p95 = percentile(metrics.latencies, 95);
  const p99 = percentile(metrics.latencies, 99);
  const throughput = metrics.totalDecisions / simDuration;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║                  RESULTS                        ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Duration:           ${simDuration.toFixed(1)}s`);
  console.log(`║  Fast ticks:         ${metrics.ticksFast}`);
  console.log(`║  Slow ticks:         ${metrics.ticksSlow}`);
  console.log(`║  Total decisions:    ${metrics.totalDecisions}`);
  console.log(`║  Throughput:         ${throughput.toFixed(2)} decisions/sec`);
  console.log(`║  Total tokens:       ${metrics.totalTokens}`);
  console.log(`║  Tokens/sec:         ${(metrics.totalTokens / simDuration).toFixed(0)}`);
  console.log(`║  Avg latency:        ${avgLatency.toFixed(0)}ms`);
  console.log(`║  p50 latency:        ${p50.toFixed(0)}ms`);
  console.log(`║  p95 latency:        ${p95.toFixed(0)}ms`);
  console.log(`║  p99 latency:        ${p99.toFixed(0)}ms`);
  console.log(`║  Errors:             ${metrics.errorCount}`);
  console.log(`║  Events injected:    ${metrics.eventsInjected}`);
  console.log(`║  Tier changes:       ${metrics.tierChanges}`);
  console.log(`║  Memories created:   ${metrics.memoriesCreated}`);
  console.log(`║  Memories pruned:    ${metrics.memoriesPruned}`);
  console.log(`║  Embeddings:         ${USE_EMBEDDINGS ? 'enabled' : 'disabled'}`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  Action Breakdown:');
  for (const [tool, count] of Object.entries(metrics.toolCalls).sort((a, b) => b[1] - a[1])) {
    console.log(`║    ${tool}: ${count} (${((count / metrics.totalDecisions) * 100).toFixed(1)}%)`);
  }
  console.log(`║    dialogue: ${metrics.dialogueCount} (${((metrics.dialogueCount / Math.max(1, metrics.totalDecisions)) * 100).toFixed(1)}%)`);
  console.log(`║    idle: ${metrics.idleCount} (${((metrics.idleCount / Math.max(1, metrics.totalDecisions)) * 100).toFixed(1)}%)`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  Expansion Systems:');
  for (const c of finalChars) {
    console.log(`║    ${c.name}: mood=${c.mood.mood}(${c.mood.intensity.toFixed(2)}) goals=${c.goals} rels=${c.rels}`);
  }
  console.log(`║  World facts: ${worldFactCount}`);
  console.log(`║  Groups: ${groupCount}`);
  console.log(`║  Player interactions tracked: ${playerProfile.totalInteractions}`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  New Systems:');
  console.log(`║    Decision log entries:  ${decisionCount}`);
  if (recentDecisions.length > 0) {
    console.log(`║    Last decision tier:    ${recentDecisions[0].inferenceTier}`);
  }
  if (introspection) {
    console.log(`║    Introspection (${introspection.character.name}):`);
    console.log(`║      Emotions:  ${introspection.emotions?.active.length ?? 0} active`);
    console.log(`║      Goals:     ${introspection.goals.length}`);
    console.log(`║      Relations: ${introspection.relationships.length}`);
    console.log(`║      Groups:    ${introspection.groups.length}`);
    console.log(`║      Memories:  ${introspection.recentMemories.length} recent`);
  }
  const exportKeys = Object.keys(exportedState).filter(k => k !== 'exportedAt');
  console.log(`║    State export:          ${exportKeys.length} sections exported`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  Final Character States:');
  for (const c of finalChars) {
    console.log(`║    ${c.name} (${c.archetype}): closeness=${c.prox?.closeness.toFixed(1) ?? '?'} tier=${c.activityTier}`);
  }
  console.log('╚══════════════════════════════════════════════════╝');
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

main().catch(console.error);
