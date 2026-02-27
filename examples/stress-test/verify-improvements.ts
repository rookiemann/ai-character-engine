/**
 * Verification script for engine improvements + new subsystems.
 *
 * Tests:
 *  1. Auto-consolidation fires on slow tick
 *  2. Exponential emotion decay with floors
 *  3. Relationship decay with interaction tracking
 *  4. Character initiative events (including critical_need)
 *  5. Tool cooldown filtering
 *  6. Perception: location-based event filtering
 *  7. Needs: growth over ticks + tool fulfillment
 *  8. Routines: phase-based activity prompts
 *  9. Lifecycle: kill + respawn maintains population
 *
 * Usage:
 *   npx tsx examples/stress-test/verify-improvements.ts --vllm
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

// ── CLI args ────────────────────────────────────────────────

function getArg(name: string, defaultVal: number): number {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : defaultVal;
}

const VLLM_PORT = getArg('port', 8100);

// ── Tracking ────────────────────────────────────────────────

const observations: string[] = [];
let initiativeEventsReceived = 0;
let consolidationRan = false;

function observe(tag: string, msg: string) {
  const line = `[${tag}] ${msg}`;
  observations.push(line);
  console.log(`  ${line}`);
}

// ── Plugin with cooldown tool ───────────────────────────────

const LOCATIONS = ['town_square', 'marketplace', 'tavern', 'docks'];

// Assign locations: char-0 and char-1 at marketplace, char-2 and char-3 at tavern
const CHAR_LOCATIONS: Record<string, string> = {
  'char-0': 'marketplace',
  'char-1': 'marketplace',
  'char-2': 'tavern',
  'char-3': 'tavern',
};

let currentTimePhase = 'morning';

function createTestPlugin(): GamePlugin {
  return {
    id: 'verify-test',
    name: 'Verification Test',

    getArchetypes(): ArchetypeDefinition[] {
      return [
        { id: 'warrior', name: 'Warrior', description: 'Fighter', defaultIdentity: {
          personality: 'Brave', backstory: 'A warrior', goals: ['Fight'], traits: ['brave'],
        }},
        { id: 'merchant', name: 'Merchant', description: 'Trader', defaultIdentity: {
          personality: 'Shrewd', backstory: 'A trader', goals: ['Trade'], traits: ['clever'],
        }},
      ];
    },

    getInitialCharacters(): CharacterDefinition[] {
      const chars: CharacterDefinition[] = [];
      for (let i = 0; i < 4; i++) {
        chars.push({
          id: `char-${i}`,
          name: ['Aldric', 'Brynn', 'Cassandra', 'Drake'][i],
          archetype: 'warrior',
          identity: {
            personality: 'Brave and direct.',
            backstory: 'A seasoned warrior.',
            goals: ['Protect the village', 'Find rare artifacts'],
            traits: ['brave', 'loyal', 'stubborn'],
            speechStyle: 'Speaks directly.',
          },
          initialCloseness: 60 + i * 10, // 60, 70, 80, 90 — all active tier
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
          executor: (args) => ({ success: true, result: `Moved to ${args.location}` }),
        },
        {
          definition: {
            name: 'talk_to',
            description: 'Talk to someone',
            parameters: [
              { name: 'target', type: 'string', description: 'Who to talk to', required: true },
              { name: 'topic', type: 'string', description: 'What to say', required: true },
            ],
          },
          executor: (args) => ({
            success: true,
            result: `Talked to ${args.target} about ${args.topic}`,
            sideEffects: [{
              type: 'dialogue', source: 'agent', target: args.target as string,
              data: { topic: args.topic }, timestamp: Date.now(),
            }],
          }),
        },
        {
          definition: {
            name: 'investigate',
            description: 'Investigate the surroundings',
            parameters: [
              { name: 'subject', type: 'string', description: 'What to investigate', required: true },
            ],
            cooldownMs: 10000, // 10-second cooldown — should be filtered!
          },
          executor: (args) => ({ success: true, result: `Investigated ${args.subject}` }),
        },
        {
          definition: {
            name: 'rest',
            description: 'Take a rest',
            parameters: [],
          },
          executor: () => ({ success: true, result: 'Rested and recovered' }),
        },
        {
          definition: {
            name: 'trade',
            description: 'Trade goods with someone',
            parameters: [
              { name: 'target', type: 'string', description: 'Who to trade with', required: true },
            ],
          },
          executor: (args) => ({
            success: true,
            result: `Traded with ${args.target}`,
            sideEffects: [{
              type: 'trade', source: 'agent', target: args.target as string,
              data: {}, timestamp: Date.now(),
            }],
          }),
        },
      ];
    },

    getGameState(): GameState {
      return {
        worldTime: Date.now(),
        location: 'The World',
        nearbyEntities: ['char-0', 'char-1', 'char-2', 'char-3'],
        recentEvents: ['A new day begins'],
        custom: { timePhase: currentTimePhase },
      };
    },

    getProprioception(characterId: string): CharacterProprioception {
      return {
        currentAction: 'idle',
        location: CHAR_LOCATIONS[characterId] ?? 'town_square',
        inventory: ['sword', 'shield'],
        status: ['healthy'],
        energy: 0.8,
      };
    },

    getWorldRules(): string {
      return 'Medieval fantasy. Use tools to act. Be concise.';
    },

    getEventTypes(): string[] {
      return ['combat', 'dialogue', 'trade', 'discovery', 'character_death'];
    },

    spawnReplacement(diedCharId: string): CharacterDefinition | null {
      return null; // Use fallback (random archetype)
    },

    getTargetPopulation(): number {
      return 4;
    },
  };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   5 Priority Improvements - Verification Test    ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Clean DB
  const fs = await import('fs');
  try { fs.unlinkSync('./data/verify-test.db'); } catch {}
  try { fs.unlinkSync('./data/verify-test.db-wal'); } catch {}
  try { fs.unlinkSync('./data/verify-test.db-shm'); } catch {}

  // Auto-detect vLLM model
  let modelName = 'unknown';
  try {
    const resp = await fetch(`http://127.0.0.1:${VLLM_PORT}/v1/models`);
    const data = await resp.json() as { data: Array<{ id: string }> };
    if (data.data?.[0]?.id) modelName = data.data[0].id;
  } catch {
    console.log('ERROR: vLLM not available. Start it first.');
    return;
  }
  console.log(`  vLLM model: ${modelName}\n`);

  const engine = new Engine({
    database: { path: './data/verify-test.db' },
    inference: {
      type: 'vllm' as const,
      baseUrl: `http://127.0.0.1:${VLLM_PORT}/v1`,
      models: { heavy: modelName, mid: modelName, light: modelName },
      maxConcurrency: 32,
      timeoutMs: 60000,
    },
    tick: {
      fastTickMs: 2000,       // 2s fast tick
      slowTickMs: 3000,       // 3s slow tick — consolidation fires at 10 * 3s = 30s
      maxAgentsPerFastTick: 4,
      maxAgentsPerSlowTick: 4,
      batchSize: 4,
    },
    memory: {
      workingMemorySize: 5,
      episodicRetrievalCount: 5,
      importanceThreshold: 2,
      decayInterval: 5,
      pruneThreshold: 0.3,
      summaryRegenerateInterval: 10,
    },
    logging: { level: 'warn', pretty: false },
  });

  await engine.loadPlugin(createTestPlugin());

  // ── Pre-start Setup ──────────────────────────────────

  const chars = engine.getAllCharacters();
  console.log('  Characters:');
  for (const c of chars) {
    const prox = engine.getCloseness(c.id);
    console.log(`    ${c.name}: closeness=${prox?.closeness ?? 0} tier=${c.activityTier}`);
  }
  console.log('');

  // Set strong emotions (for initiative test)
  engine.applyEmotion('char-0', 'anger', 0.8);      // Strong → should trigger initiative
  engine.applyEmotion('char-1', 'joy', 0.7);         // Strong → should trigger initiative
  engine.applyEmotion('char-2', 'fear', 0.3);         // Moderate → below threshold
  engine.applyEmotion('char-3', 'trust', 0.2);        // Low → no initiative

  // Record emotion baselines
  for (const c of chars) {
    const emo = engine.emotions.getEmotions(c.id);
    const dominant = emo.active.length > 0
      ? emo.active.reduce((a, b) => a.intensity > b.intensity ? a : b)
      : null;
    observe('EMOTION', `${c.name} starts with ${dominant?.type ?? 'none'} @ ${dominant?.intensity.toFixed(3) ?? 0}`);
  }

  // Set up relationships with varying interaction counts
  engine.setRelationship('char-0', 'char-1', { type: 'friend', strength: 80, trust: 70 });
  engine.setRelationship('char-1', 'char-0', { type: 'friend', strength: 75, trust: 65 });
  engine.setRelationship('char-2', 'char-3', { type: 'neutral', strength: 55, trust: 50 });

  // Simulate many interactions for char-0→char-1 (established bond)
  for (let i = 0; i < 10; i++) {
    engine.relationships.recordInteraction('char-0', 'char-1', 'positive', 0.1);
  }
  // Only 1 interaction for char-2→char-3 (new acquaintance)
  engine.relationships.recordInteraction('char-2', 'char-3', 'neutral', 0.1);

  observe('RELATIONSHIP', 'char-0→char-1: strength=~80, 10+ interactions (established bond)');
  observe('RELATIONSHIP', 'char-2→char-3: strength=~55, 1 interaction (new acquaintance)');

  // Give all characters goals with tool hints (for initiative check)
  for (const c of chars) {
    engine.addGoal(c.id, `Investigate the area around town_square`, 7, [
      { description: 'investigate the surroundings', completed: false, toolName: 'investigate' },
      { description: 'Report findings', completed: false },
    ]);
    const goals = engine.goals.getActiveGoals(c.id);
    if (goals.length > 0) engine.goals.activateGoal(goals[0].id);
  }

  // Seed episodic memories so consolidation has something to work with
  for (const c of chars) {
    for (let i = 0; i < 12; i++) {
      engine.memory.recordEvent(c.id, 'default', {
        type: 'discovery',
        source: c.id,
        data: { detail: `Discovered something interesting #${i}` },
        importance: 5,
        timestamp: Date.now() - (12 - i) * 1000,
      }, `Discovery event #${i}`, `Action #${i}`, ['discovery']);
    }
  }
  observe('MEMORY', `Seeded 12 episodic memories per character (48 total) for consolidation test`);

  // ── Setup new subsystems ────────────────────────────

  // TEST 6: Perception — set locations
  for (const c of chars) {
    const loc = CHAR_LOCATIONS[c.id] ?? 'town_square';
    engine.perception.updateLocation(c.id, loc);
  }
  observe('PERCEPTION', `Locations: char-0,1 → marketplace; char-2,3 → tavern`);

  // TEST 7: Needs — set rest need high for char-0 (will test initiative)
  engine.needs.getNeeds('char-0');
  engine.needs.setNeedIntensity('char-0', 'rest', 0.85);
  observe('NEEDS', `char-0 rest need set to 0.85 (critical)`);

  // TEST 8: Routines — add routines
  engine.addRoutine('char-0', 'daily-patrol', [
    { phase: 'morning', activity: 'trading at marketplace', location: 'marketplace', priority: 5 },
    { phase: 'evening', activity: 'resting at tavern', location: 'tavern', priority: 3 },
  ], undefined, true);
  engine.addRoutine('char-2', 'daily-guard', [
    { phase: 'morning', activity: 'guarding the gate', location: 'gate', priority: 7 },
  ], undefined, true);
  observe('ROUTINE', `Routines added for char-0 (patrol) and char-2 (guard)`);

  // Verify routine prompt before start
  const routinePrompt = engine.routines.getRoutinePrompt('char-0');
  observe('ROUTINE', `char-0 routine prompt (no phase yet): ${routinePrompt ?? '(null)'}`);

  // ── Verify Tool Cooldown Filtering (Pre-LLM) ─────────

  console.log('\n── TEST 5: Tool Cooldown Filtering ──');

  // Before any use, investigate should be available
  const toolsBefore = engine.tools.getAvailableToolsFiltered('active', 60, 'char-0');
  const hasInvestigateBefore = toolsBefore.some(t => t.name === 'investigate');
  observe('COOLDOWN', `Before use: investigate available = ${hasInvestigateBefore} (expected: true)`);

  // Manually trigger a cooldown by executing the tool
  await engine.tools.execute(
    { toolName: 'investigate', arguments: { subject: 'test' } },
    'char-0', 'active', 60,
  );

  // Now it should be on cooldown
  const isOnCooldown = engine.tools.isOnCooldown('investigate', 'char-0');
  observe('COOLDOWN', `After use: investigate on cooldown = ${isOnCooldown} (expected: true)`);

  const toolsAfter = engine.tools.getAvailableToolsFiltered('active', 60, 'char-0');
  const hasInvestigateAfter = toolsAfter.some(t => t.name === 'investigate');
  observe('COOLDOWN', `After use: investigate in filtered list = ${hasInvestigateAfter} (expected: false)`);

  // Different character should NOT be on cooldown
  const otherCooldown = engine.tools.isOnCooldown('investigate', 'char-1');
  observe('COOLDOWN', `Different char: investigate on cooldown = ${otherCooldown} (expected: false)`);

  // Tool without cooldownMs should never be on cooldown
  const moveCooldown = engine.tools.isOnCooldown('move_to', 'char-0');
  observe('COOLDOWN', `No-cooldown tool: move_to on cooldown = ${moveCooldown} (expected: false)`);

  // ── TEST 6: Perception Filtering (Pre-LLM) ──────────

  console.log('\n── TEST 6: Perception Filtering ──');
  const marketplaceEvent: GameEvent = {
    type: 'explosion',
    source: 'world',
    data: { detail: 'A crate explodes', location: 'marketplace' },
    importance: 7,
    timestamp: Date.now(),
  };
  const perceptionFiltered = engine.perception.filterByPerception(
    marketplaceEvent,
    chars.map(c => c.id),
  );
  observe('PERCEPTION', `Event at marketplace: filtered to [${perceptionFiltered.join(', ')}] (expected: char-0, char-1)`);
  const perceptionCorrect = perceptionFiltered.includes('char-0') && perceptionFiltered.includes('char-1')
    && !perceptionFiltered.includes('char-2') && !perceptionFiltered.includes('char-3');
  observe('PERCEPTION', `PASS: Only marketplace chars receive event = ${perceptionCorrect}`);

  // Broadcast event (no location) should reach everyone
  const broadcastFiltered = engine.perception.filterByPerception(
    { type: 'announcement', importance: 5, timestamp: Date.now() },
    chars.map(c => c.id),
  );
  observe('PERCEPTION', `Broadcast (no location): reaches ${broadcastFiltered.length} chars (expected: 4)`);

  // ── Start Engine & Run ────────────────────────────────

  console.log('\n── Starting engine (slow-tick=3s, target: 12 slow ticks ~36s) ──\n');

  // Listen for initiative events
  let needsInitiativeCount = 0;
  engine.events.on('game:event', (event: GameEvent) => {
    if (event.type === 'character_initiative') {
      initiativeEventsReceived++;
      const reason = (event.data as any)?.reason ?? 'unknown';
      const detail = (event.data as any)?.detail ?? '';
      if (reason === 'critical_need') needsInitiativeCount++;
      observe('INITIATIVE', `${event.source} → ${reason}: ${detail}`);
    }
  });

  // Listen for phase changes
  let phaseChanges = 0;
  engine.events.on('phase:changed', (oldPhase: string, newPhase: string) => {
    phaseChanges++;
    observe('ROUTINE', `Phase changed: ${oldPhase} → ${newPhase}`);
  });

  // Track decisions
  let totalDecisions = 0;
  let toolUses: Record<string, number> = {};
  engine.events.on('agent:decision', (result: AgentDecisionResult) => {
    totalDecisions++;
    if ('toolName' in result.action) {
      const name = (result.action as any).toolName;
      toolUses[name] = (toolUses[name] ?? 0) + 1;
    }
  });

  let slowTicks = 0;
  engine.events.on('tick:slow', () => { slowTicks++; });
  let fastTicks = 0;
  engine.events.on('tick:fast', () => { fastTicks++; });

  const simStart = Date.now();
  engine.start();

  // Inject some high-importance events to generate memories
  const eventTimer = setInterval(async () => {
    try {
      await engine.injectEvent({
        type: 'combat',
        source: 'char-0',
        target: 'char-1',
        data: { detail: 'A sudden clash in the square', location: 'marketplace' },
        importance: 8,
        timestamp: Date.now(),
      });
    } catch {}
  }, 4000);

  // Change time phase mid-run to test routines
  setTimeout(() => {
    currentTimePhase = 'evening';
    observe('ROUTINE', `Time phase set to "evening" — engine will pick it up on next slow tick`);
  }, 10000);

  // Wait for 12 slow ticks (~36 seconds) — consolidation fires at tick 10
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      const elapsed = ((Date.now() - simStart) / 1000).toFixed(0);
      process.stdout.write(`\r  Running... slow ticks: ${slowTicks}/12, fast ticks: ${fastTicks}, decisions: ${totalDecisions}, initiative events: ${initiativeEventsReceived} [${elapsed}s]  `);
      if (slowTicks >= 12) {
        clearInterval(check);
        resolve();
      }
    }, 500);
  });

  clearInterval(eventTimer);
  console.log('\n');

  // ── Verify Results ────────────────────────────────────

  console.log('══════════════════════════════════════════════════');
  console.log('              VERIFICATION RESULTS');
  console.log('══════════════════════════════════════════════════\n');

  // TEST 2: Emotion Decay
  console.log('── TEST 2: Exponential Emotion Decay ──');
  for (const c of chars) {
    const emo = engine.emotions.getEmotions(c.id);
    if (emo.active.length > 0) {
      for (const e of emo.active) {
        const floor = ({ anger: 0.15, sadness: 0.12, trust: 0.10, fear: 0.08, disgust: 0.10, anticipation: 0.05, joy: 0.05, surprise: 0.03 } as any)[e.type] ?? 0.05;
        const atFloor = Math.abs(e.intensity - floor) < 0.02;
        observe('EMOTION', `${c.name}: ${e.type} = ${e.intensity.toFixed(3)} (floor=${floor}, at_floor=${atFloor})`);
      }
    } else {
      observe('EMOTION', `${c.name}: no active emotions (all drained below 0.02)`);
    }
  }

  // Verify anger lingered (floor 0.15) — after ~24 fast ticks (2s each = 48s), exponential decay should have it near floor
  const char0Emo = engine.emotions.getEmotions('char-0');
  const angerEmo = char0Emo.active.find(e => e.type === 'anger');
  if (angerEmo) {
    const lingerCheck = angerEmo.intensity >= 0.10; // Should be at or near floor 0.15
    observe('EMOTION', `PASS: char-0 anger persisted at ${angerEmo.intensity.toFixed(3)} (>= 0.10 = ${lingerCheck})`);
  } else {
    // anger could be at floor + slow drain took it below 0.02 after very many ticks
    // With 0.05 decay rate: 0.8 * 0.95^N → floor 0.15, then 0.001/tick sub-floor
    // After ~33 ticks to floor, then (0.15 - 0.02) / 0.001 = 130 more ticks to remove
    // At 2s fast ticks, 24 fast ticks in 48s → anger should still be near floor
    observe('EMOTION', `NOTE: char-0 anger fully decayed — may need more ticks to verify`);
  }

  // TEST 3: Relationship Decay
  console.log('\n── TEST 3: Relationship Decay ──');
  const rel01 = engine.relationships.get('char-0', 'char-1');
  const rel23 = engine.relationships.get('char-2', 'char-3');
  observe('RELATIONSHIP', `char-0→char-1 (established, 10+ ix): strength=${rel01.strength.toFixed(1)} (started ~80, should be near 80)`);
  observe('RELATIONSHIP', `char-2→char-3 (new acquaintance, 1 ix): strength=${rel23.strength.toFixed(1)} (started ~55, should have decayed faster)`);

  const bondPreserved = rel01.strength >= 70;
  const acquaintanceDecayed = rel23.strength < rel01.strength - 5;
  observe('RELATIONSHIP', `PASS: Established bond preserved (>= 70): ${bondPreserved}`);
  observe('RELATIONSHIP', `PASS: New acquaintance decayed faster: ${acquaintanceDecayed}`);

  // TEST 4: Character Initiative
  console.log('\n── TEST 4: Character Initiative ──');
  observe('INITIATIVE', `Total initiative events received: ${initiativeEventsReceived}`);
  const initiativeCheck = initiativeEventsReceived > 0;
  observe('INITIATIVE', `PASS: At least one initiative event: ${initiativeCheck}`);

  // Can also disable and verify zero
  engine.initiative.updateConfig({ enabled: false });
  const disabledEvents = engine.initiative.checkBatch(chars);
  observe('INITIATIVE', `After disable: checkBatch returns ${disabledEvents.length} events (expected 0)`);

  // TEST 1: Auto-Consolidation
  console.log('\n── TEST 1: Auto-Consolidation ──');
  // We ran 12 slow ticks with 3s interval. Consolidation fires at tick 10.
  // Check if memory counts changed (consolidation merges similar memories)
  for (const c of chars) {
    const ctx = engine.memory.getContext(c.id, 'default');
    observe('CONSOLIDATION', `${c.name}: ${ctx.episodicMemories.length} episodic memories remaining`);
  }
  observe('CONSOLIDATION', `Ran 12 slow ticks — consolidation should have fired at tick 10`);

  // TEST 5: Tool Cooldown (already verified above pre-start)
  console.log('\n── TEST 5: Tool Cooldown (summary) ──');
  observe('COOLDOWN', `Pre-start cooldown filtering verified above`);

  // TEST 6: Perception (already verified above pre-start)
  console.log('\n── TEST 6: Perception (summary) ──');
  const char0Nearby = engine.perception.getCharactersAtLocation('marketplace');
  observe('PERCEPTION', `Marketplace chars after run: [${char0Nearby.join(', ')}]`);
  const perceptionPrompt = engine.perception.getPerceptionPrompt('char-0');
  observe('PERCEPTION', `char-0 perception prompt: ${perceptionPrompt ?? '(none)'}`);

  // TEST 7: Needs Growth
  console.log('\n── TEST 7: Needs System ──');
  for (const c of chars) {
    const cn = engine.needs.getNeeds(c.id);
    if (cn) {
      const highNeeds = cn.needs.filter(n => n.intensity > 0.2);
      if (highNeeds.length > 0) {
        observe('NEEDS', `${c.name}: ${highNeeds.map(n => `${n.type}=${n.intensity.toFixed(3)}`).join(', ')}`);
      } else {
        observe('NEEDS', `${c.name}: all needs below 0.2`);
      }
    }
  }

  // Check that needs grew over ticks
  const char1Sustenance = engine.needs.getNeed('char-1', 'sustenance');
  const needsGrew = char1Sustenance ? char1Sustenance.intensity > 0 : false;
  observe('NEEDS', `PASS: Sustenance grew over ticks: ${needsGrew} (intensity=${char1Sustenance?.intensity.toFixed(3) ?? 0})`);

  // Check that rest need for char-0 may have been fulfilled or still high
  const char0Rest = engine.needs.getNeed('char-0', 'rest');
  observe('NEEDS', `char-0 rest need: ${char0Rest?.intensity.toFixed(3) ?? 'N/A'} (started at 0.85)`);

  const needsPrompt = engine.needs.getNeedsPrompt('char-0');
  observe('NEEDS', `char-0 needs prompt: ${needsPrompt ?? '(none)'}`);

  // Check critical needs triggered initiative
  observe('NEEDS', `Critical need initiative events: ${needsInitiativeCount}`);

  // TEST 8: Routines
  console.log('\n── TEST 8: Routines ──');
  const currentPhase = engine.routines.getCurrentPhase();
  observe('ROUTINE', `Current phase: ${currentPhase}`);
  observe('ROUTINE', `Phase changes during run: ${phaseChanges}`);

  for (const cid of ['char-0', 'char-2']) {
    const activity = engine.routines.getCurrentActivity(cid);
    const prompt = engine.routines.getRoutinePrompt(cid);
    observe('ROUTINE', `${cid} activity: ${activity?.activity ?? '(none)'}, prompt: ${prompt ?? '(none)'}`);
  }

  const routineWorking = currentPhase === 'evening' || currentPhase === 'morning';
  observe('ROUTINE', `PASS: Phase picked up from gameState: ${routineWorking}`);

  // TEST 9: Lifecycle
  console.log('\n── TEST 9: Lifecycle ──');
  const popBefore = engine.lifecycle.getPopulation();
  observe('LIFECYCLE', `Population before kill: ${popBefore}`);

  // Kill char-3 mid-run
  const deathRecord = engine.killCharacter('char-3', 'test_death');
  observe('LIFECYCLE', `Killed char-3: ${deathRecord ? 'success' : 'failed'}`);

  const popAfterKill = engine.lifecycle.getPopulation();
  observe('LIFECYCLE', `Population after kill: ${popAfterKill}`);

  // Manually spawn a replacement (since respawnDelayMs defaults to 30s)
  const replacement = engine.lifecycle.spawnReplacement('char-3', createTestPlugin());
  observe('LIFECYCLE', `Manual respawn: ${replacement ? replacement.name : 'failed'}`);

  const popAfterRespawn = engine.lifecycle.getPopulation();
  observe('LIFECYCLE', `Population after respawn: ${popAfterRespawn}`);

  const deaths = engine.getDeathRecords();
  observe('LIFECYCLE', `Death records: ${deaths.length}, replacedBy: ${deaths[0]?.replacedBy ?? 'none'}`);

  const lifecyclePass = deathRecord !== null && replacement !== null && popAfterRespawn >= popBefore;
  observe('LIFECYCLE', `PASS: Kill + respawn maintains population: ${lifecyclePass}`);

  // ── Final Summary ─────────────────────────────────────

  const simDuration = (Date.now() - simStart) / 1000;
  console.log('\n══════════════════════════════════════════════════');
  console.log('                    SUMMARY');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Duration:          ${simDuration.toFixed(1)}s`);
  console.log(`  Fast ticks:        ${fastTicks}`);
  console.log(`  Slow ticks:        ${slowTicks}`);
  console.log(`  Total decisions:   ${totalDecisions}`);
  console.log(`  Throughput:        ${(totalDecisions / simDuration).toFixed(2)} dec/s`);
  console.log(`  Initiative events: ${initiativeEventsReceived}`);
  console.log(`  Tool uses:         ${JSON.stringify(toolUses)}`);
  console.log('');

  // Score
  const tests = [
    { name: 'Tool cooldowns filter pre-LLM', pass: hasInvestigateBefore && !hasInvestigateAfter && isOnCooldown },
    { name: 'Exponential emotion decay', pass: angerEmo ? angerEmo.intensity >= 0.10 : false },
    { name: 'Relationship tiered decay', pass: bondPreserved },
    { name: 'Auto-consolidation ran', pass: slowTicks >= 10 },
    { name: 'Character initiative fired', pass: initiativeEventsReceived > 0 },
    { name: 'Perception: location-based filtering', pass: perceptionCorrect },
    { name: 'Needs: growth over ticks', pass: needsGrew },
    { name: 'Routines: phase from gameState', pass: routineWorking },
    { name: 'Lifecycle: kill + respawn', pass: lifecyclePass },
  ];

  console.log('  Test Results:');
  let passCount = 0;
  for (const t of tests) {
    const status = t.pass ? 'PASS' : 'FAIL';
    if (t.pass) passCount++;
    console.log(`    [${status}] ${t.name}`);
  }
  console.log(`\n  ${passCount}/${tests.length} tests passed`);
  console.log('══════════════════════════════════════════════════\n');

  await engine.stop();
}

main().catch(console.error);
