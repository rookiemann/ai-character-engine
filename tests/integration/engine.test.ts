/**
 * Integration test for the AI Character Engine.
 * Tests the full lifecycle WITHOUT requiring an LLM.
 * Exercises: database, repositories, memory, proximity, tools, plugin loading,
 * agent registry, chat history, delegation, and engine wiring.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Engine } from '../../src/core/Engine';
import type {
  GamePlugin,
  ArchetypeDefinition,
  CharacterDefinition,
  ToolDefinition,
  GameState,
  CharacterProprioception,
  GameEvent,
  ChatMessage,
  ProximityScore,
} from '../../src/core/types';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';
import { ProximityRules } from '../../src/proximity/ProximityRules';
import { TokenBudget } from '../../src/inference/TokenBudget';
import { defaultImportanceScorer, createCompositeScorer } from '../../src/memory/ImportanceScorer';

// ── Mock Plugin ──────────────────────────────────────────────

function createMockPlugin(): GamePlugin {
  return {
    id: 'test-game',
    name: 'Test Game',

    getArchetypes(): ArchetypeDefinition[] {
      return [
        {
          id: 'warrior',
          name: 'Warrior',
          description: 'A brave fighter',
          defaultIdentity: {
            personality: 'Bold and direct',
            backstory: 'Trained since childhood',
            goals: ['Protect the realm'],
            traits: ['brave', 'strong'],
          },
        },
      ];
    },

    getInitialCharacters(): CharacterDefinition[] {
      return [
        {
          id: 'char-alice',
          name: 'Alice',
          archetype: 'warrior',
          identity: {
            personality: 'Fierce but kind',
            backstory: 'A wandering knight',
            goals: ['Find the lost sword'],
            traits: ['brave', 'loyal'],
            speechStyle: 'Formal, knightly',
          },
          initialCloseness: 50,
        },
        {
          id: 'char-bob',
          name: 'Bob',
          archetype: 'warrior',
          identity: {
            personality: 'Quiet and cunning',
            backstory: 'A former thief turned guard',
            goals: ['Redeem himself'],
            traits: ['sneaky', 'observant'],
          },
          initialCloseness: 10,
        },
      ];
    },

    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: {
            name: 'attack',
            description: 'Attack a target',
            parameters: [
              { name: 'target', type: 'string', description: 'Who to attack', required: true },
            ],
            category: 'combat',
          },
          executor: (args) => ({
            success: true,
            result: `Attacked ${args.target}`,
            sideEffects: [{
              type: 'combat',
              source: 'agent',
              target: args.target as string,
              data: { damage: 10 },
              timestamp: Date.now(),
            }],
          }),
        },
        {
          definition: {
            name: 'speak',
            description: 'Say something',
            parameters: [
              { name: 'message', type: 'string', description: 'What to say', required: true },
            ],
          },
          executor: (args) => ({
            success: true,
            result: `Said: ${args.message}`,
          }),
        },
        {
          definition: {
            name: 'secret_move',
            description: 'A move only close allies can use',
            parameters: [],
            minCloseness: 60,
            requiredTier: 'active' as const,
          },
          executor: () => ({ success: true, result: 'Secret move executed!' }),
        },
      ];
    },

    getGameState(): GameState {
      return {
        worldTime: Date.now(),
        location: 'Test Arena',
        nearbyEntities: ['Alice', 'Bob', 'a goblin'],
        recentEvents: ['A goblin appeared'],
        custom: { weather: 'clear', difficulty: 'normal' },
      };
    },

    getProprioception(characterId: string): CharacterProprioception {
      return {
        currentAction: 'standing guard',
        location: 'arena entrance',
        inventory: ['sword', 'shield'],
        status: ['healthy'],
        energy: 0.8,
      };
    },

    scoreImportance(characterId: string, event: GameEvent): number | undefined {
      if (event.type === 'combat' && characterId === 'char-alice') return 9;
      return undefined;
    },

    getWorldRules(): string {
      return 'This is a test world. Be concise.';
    },

    getEventTypes(): string[] {
      return ['combat', 'dialogue', 'discovery'];
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────

let engine: Engine;
const DB_PATH = './data/test-engine.db';

function createEngine(): Engine {
  return new Engine({
    database: { path: DB_PATH },
    inference: {
      type: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
      models: { heavy: 'test', mid: 'test', light: 'test' },
      maxConcurrency: 5,
    },
    tick: {
      fastTickMs: 100000, // Very slow so ticks don't fire during tests
      slowTickMs: 200000,
      batchSize: 4,
    },
    memory: {
      workingMemorySize: 5,
      episodicRetrievalCount: 5,
      importanceThreshold: 3,
    },
    logging: { level: 'warn', pretty: false },
  });
}

// ── Tests ────────────────────────────────────────────────────

describe('Engine Integration', () => {
  beforeAll(async () => {
    // Clean up any existing test db
    const fs = await import('fs');
    try { fs.unlinkSync(DB_PATH); } catch {}
    try { fs.unlinkSync(DB_PATH + '-wal'); } catch {}
    try { fs.unlinkSync(DB_PATH + '-shm'); } catch {}
  });

  afterAll(async () => {
    if (engine) await engine.stop();
    const fs = await import('fs');
    try { fs.unlinkSync(DB_PATH); } catch {}
    try { fs.unlinkSync(DB_PATH + '-wal'); } catch {}
    try { fs.unlinkSync(DB_PATH + '-shm'); } catch {}
  });

  it('should create engine with valid config', () => {
    engine = createEngine();
    expect(engine).toBeDefined();
    expect(engine.tools).toBeDefined();
    expect(engine.agents).toBeDefined();
    expect(engine.memory).toBeDefined();
    expect(engine.inference).toBeDefined();
    expect(engine.proximity).toBeDefined();
    expect(engine.delegation).toBeDefined();
    expect(engine.chat).toBeDefined();
    expect(engine.scheduler).toBeDefined();
    expect(engine.runner).toBeDefined();
  });

  it('should load a game plugin', async () => {
    const plugin = createMockPlugin();
    await engine.loadPlugin(plugin);

    // Verify tools were registered
    const tools = engine.tools.getAllDefinitions();
    expect(tools.length).toBe(3);
    expect(tools.map(t => t.name)).toContain('attack');
    expect(tools.map(t => t.name)).toContain('speak');
    expect(tools.map(t => t.name)).toContain('secret_move');
  });

  it('should register initial characters from plugin', () => {
    const all = engine.getAllCharacters();
    expect(all.length).toBe(2);

    const alice = engine.getCharacter('char-alice');
    expect(alice).not.toBeNull();
    expect(alice!.name).toBe('Alice');
    expect(alice!.archetype).toBe('warrior');
    expect(alice!.identity.personality).toContain('Fierce');
    expect(alice!.identity.traits).toContain('brave');

    const bob = engine.getCharacter('char-bob');
    expect(bob).not.toBeNull();
    expect(bob!.name).toBe('Bob');
  });

  it('should have initial closeness and proximity scores', () => {
    const aliceProx = engine.getCloseness('char-alice');
    expect(aliceProx).not.toBeNull();
    expect(aliceProx!.closeness).toBe(50);

    const bobProx = engine.getCloseness('char-bob');
    expect(bobProx).not.toBeNull();
    expect(bobProx!.closeness).toBe(10);
  });

  it('should assign correct activity tiers based on closeness', () => {
    // Alice starts with closeness 50 → background tier
    const alice = engine.getCharacter('char-alice');
    expect(alice!.activityTier).toBe('background');

    const aliceProx = engine.getCloseness('char-alice');
    expect(aliceProx).not.toBeNull();
    expect(aliceProx!.closeness).toBe(50);
    expect(aliceProx!.activityTier).toBe('background');

    // Bob starts with closeness 10 → dormant tier
    const bob = engine.getCharacter('char-bob');
    expect(bob!.activityTier).toBe('dormant');
  });

  it('should boost closeness and change tiers', () => {
    // Boost Alice from 50 to 75 → should become active
    const updated = engine.boostCloseness('char-alice', 25);
    expect(updated.closeness).toBe(75);
    expect(updated.activityTier).toBe('active');
    expect(updated.highWaterMark).toBe(75);

    // Boost Bob from 10 to 15 → still dormant
    const bobUpdated = engine.boostCloseness('char-bob', 5);
    expect(bobUpdated.closeness).toBe(15);
    expect(bobUpdated.activityTier).toBe('dormant');
  });

  it('should track high water mark', () => {
    const aliceProx = engine.getCloseness('char-alice');
    expect(aliceProx!.highWaterMark).toBe(75);
  });

  it('should filter available tools by tier and closeness', () => {
    // Active tier, closeness 75 → should see all tools including secret_move
    const activeTools = engine.tools.getAvailableTools('active', 75);
    expect(activeTools.map(t => t.name)).toContain('secret_move');

    // Background tier, closeness 50 → should NOT see secret_move
    const bgTools = engine.tools.getAvailableTools('background', 50);
    expect(bgTools.map(t => t.name)).not.toContain('secret_move');

    // Active tier, closeness 30 → should NOT see secret_move (closeness too low)
    const lowTools = engine.tools.getAvailableTools('active', 30);
    expect(lowTools.map(t => t.name)).not.toContain('secret_move');
  });

  it('should execute tools through the registry', async () => {
    const result = await engine.tools.execute(
      { toolName: 'attack', arguments: { target: 'goblin' } },
      'char-alice',
      'active',
      75,
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe('Attacked goblin');
    expect(result.sideEffects).toHaveLength(1);
    expect(result.sideEffects![0].type).toBe('combat');
  });

  it('should reject tools that dont meet requirements', async () => {
    // Try secret_move with background tier → should fail
    // ToolRegistry.getAvailableTools filters it out, so execute sees "Unknown tool"
    await expect(
      engine.tools.execute(
        { toolName: 'secret_move', arguments: {} },
        'char-bob',
        'background',
        50,
      ),
    ).rejects.toThrow('Unknown tool');
  });

  it('should record episodic memories', () => {
    // Note: The plugin's scoreImportance overrides combat events for char-alice to 9
    const event: GameEvent = {
      type: 'combat',
      source: 'char-alice',
      target: 'goblin',
      data: { damage: 10 },
      importance: 7, // This gets overridden by plugin scorer to 9
      timestamp: Date.now(),
    };

    const memory = engine.memory.recordEvent(
      'char-alice',
      'default',
      event,
      'Alice attacked the goblin for 10 damage',
      'Alice fought a goblin',
      ['combat', 'goblin'],
    );

    expect(memory).not.toBeNull();
    // Plugin scorer returns 9 for combat events for char-alice
    expect(memory!.importance).toBe(9);
    expect(memory!.isDeep).toBe(true); // >= 9 is deep
    expect(memory!.tags).toContain('combat');
  });

  it('should create deep memories for high importance events', () => {
    // Use char-bob (no plugin override) to test explicit importance
    const event: GameEvent = {
      type: 'betrayal',
      source: 'player',
      target: 'char-bob',
      importance: 10,
      timestamp: Date.now(),
    };

    const memory = engine.memory.recordEvent(
      'char-bob',
      'default',
      event,
      'A terrible betrayal occurred',
      'Bob\'s betrayal - a core memory',
      ['betrayal'],
    );

    expect(memory).not.toBeNull();
    expect(memory!.importance).toBe(10);
    expect(memory!.isPermanent).toBe(true); // Importance 10 = trauma (permanent)
    expect(memory!.isDeep).toBe(false);     // Permanent supersedes deep
    expect(memory!.decayRate).toBe(0);      // Permanent memories never decay
  });

  it('should skip low importance events', () => {
    const event: GameEvent = {
      type: 'ambient',
      importance: 1,
      timestamp: Date.now(),
    };

    const memory = engine.memory.recordEvent(
      'char-alice',
      'default',
      event,
      'A bird flew by',
      'Nothing happened',
      ['ambient'],
    );

    expect(memory).toBeNull(); // Below threshold (3)
  });

  it('should store and retrieve working memory', () => {
    engine.memory.addWorkingMemory('char-alice', 'default', 'user', 'Hello Alice');
    engine.memory.addWorkingMemory('char-alice', 'default', 'assistant', 'Hello traveler!');
    engine.memory.addWorkingMemory('char-alice', 'default', 'user', 'How are you?');

    const context = engine.memory.getContext('char-alice', 'default');
    expect(context.workingMemory.length).toBeGreaterThanOrEqual(3);
    expect(context.workingMemory[0].role).toBeDefined();
  });

  it('should retrieve episodic memories in context', () => {
    const context = engine.memory.getContext('char-alice', 'default');
    expect(context.episodicMemories.length).toBeGreaterThanOrEqual(1);

    // Deep memories should be present (highest importance)
    const deep = context.episodicMemories.find(m => m.isDeep);
    expect(deep).toBeDefined();
  });

  it('should apply memory decay and pruning', () => {
    // Apply heavy decay
    const decayed = engine.memory.episodic.applyDecay(5);
    expect(decayed).toBeGreaterThan(0);

    // Deep memories (decay rate 0.1) should barely change: 9 - (5 * 0.1) = 8.5
    // Bob's deep memory (importance 10): 10 - (5 * 0.1) = 9.5
    const aliceCtx = engine.memory.getContext('char-alice', 'default');
    const aliceDeep = aliceCtx.episodicMemories.find(m => m.isDeep);
    if (aliceDeep) {
      expect(aliceDeep.currentImportance).toBeGreaterThan(8);
    }

    // Prune anything below 1.0
    const pruned = engine.memory.episodic.prune(1.0);
    expect(pruned).toBeGreaterThanOrEqual(0);
  });

  it('should allow chat with close characters', () => {
    // Alice has closeness 75 → can chat (threshold 40)
    expect(engine.proximity.canChat('char-alice', 'default')).toBe(true);

    // Bob has closeness 15 → cannot chat
    expect(engine.proximity.canChat('char-bob', 'default')).toBe(false);
  });

  it('should allow delegation only to very close characters', () => {
    // Alice has closeness 75 → can delegate (threshold 60)
    expect(engine.proximity.canDelegate('char-alice', 'default')).toBe(true);

    // Bob has closeness 15 → cannot delegate
    expect(engine.proximity.canDelegate('char-bob', 'default')).toBe(false);
  });

  it('should create and manage delegations', () => {
    const order = engine.delegateTo(
      'char-alice',
      'Guard the east gate',
      'security',
    );

    expect(order.id).toBeDefined();
    expect(order.instruction).toBe('Guard the east gate');
    expect(order.active).toBe(true);

    // Retrieve active delegations
    const active = engine.delegation.getActive('char-alice', 'default');
    expect(active.length).toBe(1);

    // Revoke
    engine.delegation.revoke(order.id);
    const afterRevoke = engine.delegation.getActive('char-alice', 'default');
    expect(afterRevoke.length).toBe(0);
  });

  it('should reject delegation to low-closeness characters', () => {
    expect(() => {
      engine.delegateTo('char-bob', 'Do something', 'general');
    }).toThrow('closeness too low');
  });

  it('should emit events correctly', async () => {
    const events: string[] = [];

    engine.events.on('proximity:changed', () => events.push('prox'));
    engine.events.on('memory:created', () => events.push('mem'));

    // Trigger a boost (fires proximity:changed)
    engine.boostCloseness('char-bob', 5);

    // Record a memory (fires memory:created)
    engine.memory.recordEvent(
      'char-bob',
      'default',
      { type: 'discovery', importance: 5, timestamp: Date.now() },
      'Bob found something',
      'A discovery',
      ['discovery'],
    );

    expect(events).toContain('prox');
    expect(events).toContain('mem');
  });

  it('should build correct context for agent decisions', () => {
    const context = engine.memory.getContext('char-alice', 'default', {
      tags: ['combat'],
      eventType: 'combat',
    });

    expect(context.workingMemory).toBeDefined();
    expect(context.episodicMemories).toBeDefined();
    // Summary will be null since we haven't generated one yet
    expect(context.characterSummary).toBeNull();
  });

  it('should update character summaries', () => {
    const summary = engine.memory.updateSummary(
      'char-alice',
      'default',
      'Alice is a fierce warrior who recently fought a goblin and was betrayed by Bob.',
      'Player is a trusted ally who she fights alongside.',
      ['Fought a goblin', 'Betrayed by Bob', 'Loyal to the player'],
    );

    expect(summary.version).toBe(1);
    expect(summary.keyFacts).toHaveLength(3);

    // Now context should include summary
    const context = engine.memory.getContext('char-alice', 'default');
    expect(context.characterSummary).not.toBeNull();
    expect(context.characterSummary!.summary).toContain('fierce warrior');
  });

  it('should report engine stats', () => {
    const stats = engine.getStats();
    expect(stats.characters).toBeDefined();
    expect(stats.inference).toBeDefined();
    expect(stats.scheduler).toBeDefined();
    expect(stats.inference.provider).toBe('lmstudio');
  });

  it('should start and stop the tick scheduler', () => {
    engine.start();
    expect(engine.scheduler.isRunning).toBe(true);

    // Stats should reflect running state
    expect(engine.getStats().scheduler.running).toBe(true);
  });

  it('should stop cleanly', async () => {
    await engine.stop();
    expect(engine.scheduler.isRunning).toBe(false);
  });
});

// ── Config Validation Tests ──────────────────────────────────

describe('Config Validation', () => {
  it('should reject invalid config', () => {
    expect(() => {
      new Engine({ database: {} });
    }).toThrow();
  });

  it('should reject missing inference config', () => {
    expect(() => {
      new Engine({ database: { path: ':memory:' } });
    }).toThrow();
  });

  it('should apply defaults for optional config', () => {
    const e = new Engine({
      database: { path: ':memory:' },
      inference: {
        type: 'lmstudio',
        models: { heavy: 'a', mid: 'b', light: 'c' },
      },
    });

    const stats = e.getStats();
    expect(stats).toBeDefined();
  });
});

// ── Tool System Tests ────────────────────────────────────────

describe('Tool System', () => {
  it('should validate tool calls', async () => {
    const e = new Engine({
      database: { path: ':memory:' },
      inference: {
        type: 'lmstudio',
        models: { heavy: 'a', mid: 'b', light: 'c' },
      },
    });

    e.tools.register(
      {
        name: 'test_tool',
        description: 'A test tool',
        parameters: [
          { name: 'required_param', type: 'string', description: 'Required', required: true },
        ],
      },
      (args) => ({ success: true, result: args.required_param }),
    );

    // Missing required param
    await expect(
      e.tools.execute(
        { toolName: 'test_tool', arguments: {} },
        'test-char',
        'active',
        100,
      ),
    ).rejects.toThrow('Missing required parameter');

    // With required param
    const result = await e.tools.execute(
      { toolName: 'test_tool', arguments: { required_param: 'hello' } },
      'test-char',
      'active',
      100,
    );
    expect(result.success).toBe(true);
  });

  it('should enforce cooldowns', async () => {
    const e = new Engine({
      database: { path: ':memory:' },
      inference: {
        type: 'lmstudio',
        models: { heavy: 'a', mid: 'b', light: 'c' },
      },
    });

    e.tools.register(
      {
        name: 'cooldown_tool',
        description: 'Has a cooldown',
        parameters: [],
        cooldownMs: 5000,
      },
      () => ({ success: true, result: 'done' }),
    );

    // First call succeeds
    const r1 = await e.tools.execute(
      { toolName: 'cooldown_tool', arguments: {} },
      'test-char',
      'active',
      100,
    );
    expect(r1.success).toBe(true);

    // Second call within cooldown
    const r2 = await e.tools.execute(
      { toolName: 'cooldown_tool', arguments: {} },
      'test-char',
      'active',
      100,
    );
    expect(r2.success).toBe(false);
    expect(r2.error).toContain('cooldown');
  });
});

// ── Proximity Rules Tests ────────────────────────────────────

describe('Proximity Rules', () => {
  it('should calculate correct tiers', () => {
    const rules = new ProximityRules();

    expect(rules.getTier(0)).toBe('dormant');
    expect(rules.getTier(10)).toBe('dormant');
    expect(rules.getTier(20)).toBe('background');
    expect(rules.getTier(50)).toBe('background');
    expect(rules.getTier(60)).toBe('active');
    expect(rules.getTier(100)).toBe('active');
  });

  it('should clamp closeness to 0-100', () => {
    const rules = new ProximityRules();

    const score = {
      characterId: 'test',
      playerId: 'default',
      closeness: 95,
      highWaterMark: 95,
      activityTier: 'active' as const,
      lastInteractionAt: Date.now(),
      totalInteractions: 0,
      updatedAt: Date.now(),
    };

    const boosted = rules.applyChange(score, 50);
    expect(boosted.closeness).toBe(100); // Clamped

    const reduced = rules.applyChange(score, -200);
    expect(reduced.closeness).toBe(0); // Clamped
  });

  it('should reduce decay for high water mark characters', () => {
    const rules = new ProximityRules();

    const established = {
      characterId: 'test',
      playerId: 'default',
      closeness: 30,
      highWaterMark: 80, // Was very close before
      activityTier: 'background' as const,
      lastInteractionAt: Date.now(),
      totalInteractions: 10,
      updatedAt: Date.now(),
    };

    const fresh = {
      ...established,
      highWaterMark: 30, // Never been close
    };

    const estDecay = rules.calculateDecay(established);
    const freshDecay = rules.calculateDecay(fresh);

    expect(estDecay).toBeLessThan(freshDecay); // Established relationships fade slower
  });
});

// ── Token Budget Tests ───────────────────────────────────────

describe('Token Budget', () => {
  it('should select correct inference tiers', () => {
    const budget = new TokenBudget();

    expect(budget.selectInferenceTier('active', 9)).toBe('heavy');
    expect(budget.selectInferenceTier('active', 5)).toBe('heavy');
    expect(budget.selectInferenceTier('active', 3)).toBe('mid');
    expect(budget.selectInferenceTier('background')).toBe('mid');
    expect(budget.selectInferenceTier('background', 8)).toBe('heavy');
    expect(budget.selectInferenceTier('dormant')).toBe('light');
  });

  it('should trim text to fit budget', () => {
    const budget = new TokenBudget();

    const longText = 'a'.repeat(1000);
    const trimmed = budget.trimToFit(longText, 50); // ~200 chars
    expect(trimmed.length).toBeLessThan(longText.length);
    expect(trimmed.startsWith('...')).toBe(true);
  });

  it('should trim arrays to fit budget', () => {
    const budget = new TokenBudget();

    const items = ['aaaa'.repeat(100), 'bbbb'.repeat(100), 'cccc'.repeat(100)];
    const trimmed = budget.trimArrayToFit(items, 150); // Can't fit all 3
    expect(trimmed.length).toBeLessThan(items.length);
    // Should keep the latest (last) items
    expect(trimmed[trimmed.length - 1]).toBe(items[items.length - 1]);
  });
});

// ── Importance Scorer Tests ──────────────────────────────────

describe('Importance Scorer', () => {
  it('should score events by type', () => {

    expect(defaultImportanceScorer({ type: 'combat', timestamp: 0 }, 'char-a')).toBe(7);
    expect(defaultImportanceScorer({ type: 'death', timestamp: 0 }, 'char-a')).toBe(10);
    expect(defaultImportanceScorer({ type: 'routine', timestamp: 0 }, 'char-a')).toBe(2);
    expect(defaultImportanceScorer({ type: 'ambient', timestamp: 0 }, 'char-a')).toBe(1);
  });

  it('should use event-provided importance when available', () => {

    expect(defaultImportanceScorer({ type: 'combat', importance: 3, timestamp: 0 }, 'char-a')).toBe(3);
  });

  it('should create composite scorer with game override', () => {

    const scorer = createCompositeScorer((charId: string, event: GameEvent) => {
      if (event.type === 'custom_event') return 10;
      return undefined;
    });

    expect(scorer({ type: 'custom_event', timestamp: 0 }, 'char-a')).toBe(10);
    expect(scorer({ type: 'combat', timestamp: 0 }, 'char-a')).toBe(7); // Falls back to default
  });
});
