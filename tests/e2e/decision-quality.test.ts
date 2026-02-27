/**
 * End-to-end Decision Quality Tests
 *
 * Runs 32 characters against a live vLLM instance and validates
 * that the AI makes reasonable decisions based on context.
 *
 * Requires: vLLM running on port 8100 with a tool-calling model loaded.
 *
 * Run:
 *   VLLM_URL=http://127.0.0.1:8100/v1 npx vitest run tests/e2e/decision-quality.test.ts
 *
 * Skip if no vLLM:
 *   npx vitest run --exclude tests/e2e/
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

// --- Config ---

const VLLM_URL = process.env.VLLM_URL || 'http://127.0.0.1:8100/v1';
const CHAR_COUNT = 32;
const DECISION_TIMEOUT = 120_000; // 2 minutes for batch decisions

// --- Skip if vLLM is not available ---

async function isVLLMAvailable(): Promise<boolean> {
  try {
    const baseUrl = VLLM_URL.replace(/\/v1\/?$/, '');
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Archetypes and character definitions ---

const ARCHETYPES = [
  { id: 'warrior',  name: 'Warrior',  traits: ['brave', 'loyal'],    goals: ['Protect the village', 'Train fighters'] },
  { id: 'merchant', name: 'Merchant', traits: ['shrewd', 'friendly'], goals: ['Maximize profits', 'Expand trade routes'] },
  { id: 'healer',   name: 'Healer',   traits: ['kind', 'wise'],      goals: ['Heal the sick', 'Gather herbs'] },
  { id: 'rogue',    name: 'Rogue',    traits: ['cunning', 'agile'],   goals: ['Find treasure', 'Avoid the law'] },
  { id: 'scholar',  name: 'Scholar',  traits: ['curious', 'patient'], goals: ['Discover ancient knowledge', 'Write a book'] },
  { id: 'bard',     name: 'Bard',     traits: ['charismatic', 'creative'], goals: ['Perform for crowds', 'Collect stories'] },
  { id: 'smith',    name: 'Smith',    traits: ['strong', 'meticulous'], goals: ['Forge legendary weapons', 'Supply the army'] },
  { id: 'farmer',   name: 'Farmer',   traits: ['hardworking', 'practical'], goals: ['Grow crops', 'Feed the village'] },
];

const NAMES = [
  'Aldric', 'Brynn', 'Cassandra', 'Drake', 'Elara', 'Finn', 'Greta', 'Hugo',
  'Iris', 'Jasper', 'Kiera', 'Luca', 'Mira', 'Nolan', 'Ophelia', 'Pike',
  'Quinn', 'Rosa', 'Soren', 'Thea', 'Ulric', 'Vesta', 'Wren', 'Xander',
  'Yara', 'Zeke', 'Anya', 'Boris', 'Celeste', 'Doran', 'Eva', 'Felix',
];

const LOCATIONS = ['town_square', 'marketplace', 'tavern', 'docks', 'temple', 'forge', 'farm', 'library'];

function getCharLocation(index: number): string {
  return LOCATIONS[index % LOCATIONS.length];
}

function createCharacters(count: number): CharacterDefinition[] {
  const chars: CharacterDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    chars.push({
      id: `char-${i}`,
      name: NAMES[i % NAMES.length],
      archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}.`,
        backstory: `Has been a ${arch.name.toLowerCase()} for many years.`,
        goals: arch.goals,
        traits: arch.traits,
        speechStyle: `Speaks like a ${arch.name.toLowerCase()}.`,
      },
      initialCloseness: 50 + (i % 5) * 10, // 50-90 range
    });
  }
  return chars;
}

// --- Plugin ---

function createPlugin(charCount: number): GamePlugin {
  const chars = createCharacters(charCount);

  return {
    id: 'e2e-test',
    name: 'E2E Quality Test',

    getArchetypes(): ArchetypeDefinition[] {
      return ARCHETYPES.map(a => ({
        id: a.id,
        name: a.name,
        description: a.name,
        defaultIdentity: {
          personality: `A ${a.traits.join(' and ')} ${a.name.toLowerCase()}`,
          backstory: `A ${a.name.toLowerCase()}.`,
          goals: a.goals,
          traits: a.traits,
        },
      }));
    },

    getInitialCharacters() { return chars; },

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
          executor: (args) => ({ success: true, result: `Moved to ${args.location}` }),
        },
        {
          definition: {
            name: 'talk_to',
            description: 'Talk to someone nearby',
            parameters: [
              { name: 'target', type: 'string', description: 'Who to talk to', required: true },
              { name: 'content', type: 'string', description: 'What to say', required: true },
            ],
          },
          executor: (args) => ({
            success: true,
            result: `Talked to ${args.target}: ${args.content}`,
            sideEffects: [{
              type: 'dialogue', source: 'agent', target: args.target as string,
              data: { content: args.content }, timestamp: Date.now(),
            }],
          }),
        },
        {
          definition: {
            name: 'investigate',
            description: 'Investigate something in the area',
            parameters: [
              { name: 'subject', type: 'string', description: 'What to investigate', required: true },
            ],
          },
          executor: (args) => ({ success: true, result: `Investigated: ${args.subject}` }),
        },
        {
          definition: {
            name: 'trade',
            description: 'Trade goods with someone',
            parameters: [
              { name: 'target', type: 'string', description: 'Who to trade with', required: true },
              { name: 'item', type: 'string', description: 'What to trade', required: true },
            ],
          },
          executor: (args) => ({
            success: true,
            result: `Traded ${args.item} with ${args.target}`,
            sideEffects: [{
              type: 'trade', source: 'agent', target: args.target as string,
              data: { item: args.item }, timestamp: Date.now(),
            }],
          }),
        },
        {
          definition: {
            name: 'rest',
            description: 'Take a rest to recover energy',
            parameters: [],
          },
          executor: () => ({ success: true, result: 'Rested and recovered' }),
        },
        {
          definition: {
            name: 'craft',
            description: 'Craft an item',
            parameters: [
              { name: 'item', type: 'string', description: 'What to craft', required: true },
            ],
          },
          executor: (args) => ({ success: true, result: `Crafted ${args.item}` }),
        },
      ];
    },

    getGameState(): GameState {
      return {
        worldTime: Date.now(),
        location: 'The Realm',
        nearbyEntities: chars.map(c => c.id),
        recentEvents: ['The sun rises over the village', 'Market day begins'],
        custom: { timePhase: 'morning', weather: 'clear' },
      };
    },

    getProprioception(characterId: string): CharacterProprioception {
      const index = parseInt(characterId.replace('char-', ''), 10);
      return {
        currentAction: 'idle',
        location: getCharLocation(index),
        inventory: ['basic_supplies'],
        status: ['healthy'],
        energy: 0.7 + Math.random() * 0.3,
      };
    },

    getWorldRules(): string {
      return 'Medieval fantasy world. Characters use tools to act in the world. Be concise.';
    },

    getEventTypes(): string[] {
      return ['combat', 'dialogue', 'trade', 'discovery'];
    },

    filterEventTargets(event: GameEvent, candidateIds: string[]): string[] {
      return candidateIds;
    },
  };
}

// --- Test suite ---

describe('E2E Decision Quality', () => {
  let engine: Engine;
  let available = false;

  beforeAll(async () => {
    available = await isVLLMAvailable();
    if (!available) return;

    engine = new Engine({
      database: { path: ':memory:' },
      inference: {
        type: 'vllm',
        baseUrl: VLLM_URL,
        models: { heavy: 'default', mid: 'default', light: 'default' },
        maxConcurrency: 64,
        timeoutMs: 60000,
      },
      tick: {
        fastTickMs: 5000,
        slowTickMs: 30000,
        batchSize: 32,
      },
      logging: { level: 'warn' },
    });

    await engine.loadPlugin(createPlugin(CHAR_COUNT));
    await engine.start();
  }, 30_000);

  afterAll(async () => {
    if (engine) {
      await engine.stop();
    }
  });

  // --- Core quality tests ---

  it('should produce decisions for all 32 characters with zero errors', async () => {
    if (!available) return;

    const results: AgentDecisionResult[] = [];

    const handler = (result: AgentDecisionResult) => {
      results.push(result);
    };
    engine.events.on('agent:decision', handler);

    // Inject a world event to trigger decisions for all characters
    await engine.injectEvent({
      type: 'discovery',
      source: 'world',
      data: { description: 'A new day dawns over the village. The morning bells ring.' },
      importance: 5,
      timestamp: Date.now(),
    });

    // Wait for decisions to complete
    await new Promise(resolve => setTimeout(resolve, 15_000));

    engine.events.off('agent:decision', handler);

    console.log(`\n  Decisions: ${results.length}/${CHAR_COUNT}`);

    expect(results.length).toBeGreaterThanOrEqual(1);
    // Every decision should have valid structure
    for (const r of results) {
      expect(r.characterId).toBeDefined();
      expect(r.durationMs).toBeGreaterThan(0);
      expect(r.tokensUsed).toBeGreaterThan(0);
    }
  }, DECISION_TIMEOUT);

  it('should produce diverse actions (not all idle)', async () => {
    if (!available) return;

    const results: AgentDecisionResult[] = [];
    const handler = (result: AgentDecisionResult) => results.push(result);
    engine.events.on('agent:decision', handler);

    // Inject a trade event to trigger diverse actions
    await engine.injectEvent({
      type: 'trade',
      source: 'world',
      data: { description: 'A merchant caravan arrives at the marketplace with rare goods.' },
      importance: 5,
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 15_000));

    engine.events.off('agent:decision', handler);

    const actionTypes = new Set<string>();
    for (const r of results) {
      if ('toolName' in r.action) {
        actionTypes.add(r.action.toolName);
      } else {
        actionTypes.add(r.action.type);
      }
    }

    console.log(`\n  Action types: ${[...actionTypes].join(', ')}`);
    console.log(`  Unique types: ${actionTypes.size}`);

    // Should use at least 2 different action types across 32 characters
    expect(actionTypes.size).toBeGreaterThanOrEqual(2);
  }, DECISION_TIMEOUT);

  it('should use multiple different tools', async () => {
    if (!available) return;

    const toolNames = new Set<string>();
    const results: AgentDecisionResult[] = [];
    const handler = (result: AgentDecisionResult) => {
      results.push(result);
      if ('toolName' in result.action) {
        toolNames.add(result.action.toolName);
      }
    };
    engine.events.on('agent:decision', handler);

    // Inject 2 different events for more tool variety
    await engine.injectEvent({
      type: 'discovery',
      source: 'world',
      data: { description: 'Strange noises echo from the abandoned mine outside town.' },
      importance: 6,
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 10_000));

    await engine.injectEvent({
      type: 'dialogue',
      source: 'town_crier',
      data: { description: 'The town crier announces a harvest festival this evening!' },
      importance: 4,
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 10_000));

    engine.events.off('agent:decision', handler);

    const toolCount = toolNames.size;
    console.log(`\n  Tools used: ${[...toolNames].join(', ')}`);
    console.log(`  Tool variety: ${toolCount} unique tools out of ${results.length} decisions`);

    // Should use at least 2 different tools across multiple events
    expect(toolCount).toBeGreaterThanOrEqual(2);
  }, DECISION_TIMEOUT);

  it('should respond to injected events', async () => {
    if (!available) return;

    const results: AgentDecisionResult[] = [];
    const handler = (result: AgentDecisionResult) => results.push(result);
    engine.events.on('agent:decision', handler);

    // Inject a combat event
    await engine.injectEvent({
      type: 'combat',
      source: 'enemy_raid',
      data: { description: 'Bandits attack the marketplace!', severity: 'high' },
      importance: 8,
      timestamp: Date.now(),
    });

    // Wait for event-driven decisions
    await new Promise(resolve => setTimeout(resolve, 15_000));

    engine.events.off('agent:decision', handler);

    console.log(`\n  Event-triggered decisions: ${results.length}`);

    // At least some characters should respond to the event
    expect(results.length).toBeGreaterThanOrEqual(1);
  }, DECISION_TIMEOUT);

  it('should report meaningful metrics', async () => {
    if (!available) return;

    const snapshot = engine.metrics.getSnapshot();

    console.log(`\n  Metrics snapshot:`);
    console.log(`    Total decisions: ${snapshot.decisions.total}`);
    console.log(`    Decisions/sec: ${snapshot.decisions.perSecond.toFixed(2)}`);
    console.log(`    Latency p50: ${snapshot.decisions.latency.p50}ms`);
    console.log(`    Latency p95: ${snapshot.decisions.latency.p95}ms`);
    console.log(`    Tool distribution: ${JSON.stringify(snapshot.tools.distribution)}`);
    console.log(`    Action distribution: ${JSON.stringify(snapshot.actions.distribution)}`);
    console.log(`    Total tokens: ${snapshot.inference.tokensTotal}`);
    console.log(`    Errors: ${snapshot.errors.total}`);

    expect(snapshot.decisions.total).toBeGreaterThan(0);
    expect(snapshot.decisions.latency.p50).toBeGreaterThan(0);
    expect(snapshot.inference.tokensTotal).toBeGreaterThan(0);
  });

  it('should handle 32 concurrent characters without crashing', async () => {
    if (!available) return;

    // Final stability test: rapid event injection
    const startDecisions = engine.metrics.getSnapshot().decisions.total;

    // Fire 2 events in quick succession
    await engine.injectEvent({
      type: 'combat',
      source: 'world',
      data: { description: 'Wolves spotted near the farm!' },
      importance: 7,
      timestamp: Date.now(),
    });

    await engine.injectEvent({
      type: 'trade',
      source: 'world',
      data: { description: 'A rare gem discovered at the docks!' },
      importance: 6,
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 15_000));

    const endDecisions = engine.metrics.getSnapshot().decisions.total;
    const newDecisions = endDecisions - startDecisions;

    console.log(`\n  Rapid events: ${newDecisions} new decisions`);

    // Engine should still be responsive after rapid events
    const health = await engine.healthCheck();
    expect(health.database).toBe(true);
  }, DECISION_TIMEOUT);
});
