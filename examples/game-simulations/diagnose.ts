/**
 * Model Diagnostic — Captures raw LLM outputs and categorizes failures
 *
 * Answers: "When the 1B model fails to produce a tool call, what does it actually output?"
 *
 * Usage:
 *   npx tsx examples/game-simulations/diagnose.ts
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

const VLLM_PORT = 8100;
const NUM_CHARS = 32;

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Failure categories ────────────────────────────────────

interface RawDecision {
  characterId: string;
  archetype: string;
  actionType: 'tool' | 'dialogue' | 'idle';
  toolName?: string;
  rawOutput: string;
  tokensUsed: number;
  durationMs: number;
}

function categorize(raw: string): string {
  if (!raw || raw.length === 0) return 'empty_response';

  // Check if it's valid JSON tool call
  try {
    const parsed = JSON.parse(raw);
    if (parsed.tool || parsed.name || parsed.action) return 'valid_json_tool';
    return 'json_but_no_tool_key';
  } catch {}

  // Check for JSON-like content
  if (raw.includes('{') && raw.includes('}')) {
    // Has JSON but malformed
    if (raw.includes("'")) return 'single_quote_json';
    if (raw.match(/\w+\s*:/)) return 'unquoted_keys_json';
    if (raw.includes(',}') || raw.includes(',]')) return 'trailing_comma_json';
    return 'malformed_json';
  }

  // Check for tool name mentions in plain text
  const toolNames = ['sail_to', 'board_enemy', 'search_treasure', 'negotiate', 'repair_ship', 'fire_cannons',
    'repair_system', 'scan_sector', 'treat_patient', 'run_experiment', 'send_transmission', 'deploy_defense',
    'tend_crops', 'craft_item', 'trade_goods', 'visit_neighbor', 'forage', 'cook_meal',
    'move_to', 'talk_to', 'trade', 'investigate', 'rest', 'craft'];
  const mentionedTool = toolNames.find(t => raw.toLowerCase().includes(t.replace('_', ' ')) || raw.toLowerCase().includes(t));
  if (mentionedTool) return `plain_text_mentions_${mentionedTool}`;

  // Check for narrative/roleplay
  if (raw.startsWith('"') || raw.startsWith('*') || raw.startsWith("'")) return 'roleplay_text';
  if (raw.match(/^(I |He |She |They |The )/)) return 'narrative_text';

  // Check for thinking tags
  if (raw.includes('<think>')) return 'thinking_tags_only';

  // Short gibberish
  if (raw.length < 10) return 'too_short';
  if (raw.length > 500) return 'too_long';

  return 'unstructured_text';
}

// ── Simple mixed-genre plugin ────────────────────────────

function createDiagPlugin(): GamePlugin {
  const LOCATIONS = ['town_square', 'market', 'docks', 'forest', 'castle', 'tavern', 'bridge', 'farm'];
  const ARCHETYPES = [
    { id: 'warrior', name: 'Warrior', traits: ['brave', 'loyal'], goals: ['Protect the village'] },
    { id: 'merchant', name: 'Merchant', traits: ['shrewd', 'friendly'], goals: ['Make a profit'] },
    { id: 'healer', name: 'Healer', traits: ['kind', 'wise'], goals: ['Heal the sick'] },
    { id: 'rogue', name: 'Rogue', traits: ['cunning', 'agile'], goals: ['Find treasure'] },
    { id: 'scholar', name: 'Scholar', traits: ['curious', 'patient'], goals: ['Learn secrets'] },
    { id: 'farmer', name: 'Farmer', traits: ['hardworking', 'practical'], goals: ['Feed the village'] },
    { id: 'smith', name: 'Smith', traits: ['strong', 'meticulous'], goals: ['Forge a masterwork'] },
    { id: 'bard', name: 'Bard', traits: ['charismatic', 'creative'], goals: ['Perform a ballad'] },
  ];
  const NAMES = [
    'Aldric', 'Brynn', 'Cass', 'Drake', 'Elara', 'Finn', 'Greta', 'Hugo',
    'Iris', 'Jasper', 'Kiera', 'Luca', 'Mira', 'Nolan', 'Ophelia', 'Pike',
    'Quinn', 'Rosa', 'Soren', 'Thea', 'Ulric', 'Vesta', 'Wren', 'Xander',
    'Yara', 'Zeke', 'Anya', 'Boris', 'Celeste', 'Doran', 'Eva', 'Felix',
  ];

  const chars: CharacterDefinition[] = [];
  for (let i = 0; i < NUM_CHARS; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length];
    chars.push({
      id: `char-${i}`, name: NAMES[i], archetype: arch.id,
      identity: {
        personality: `A ${arch.traits.join(' and ')} ${arch.name.toLowerCase()}.`,
        backstory: `Has been a ${arch.name.toLowerCase()} for many years.`,
        goals: arch.goals, traits: arch.traits,
        speechStyle: `Speaks like a ${arch.name.toLowerCase()}.`,
      },
      initialCloseness: 50 + (i % 5) * 10,
    });
  }

  return {
    id: 'diag', name: 'Diagnostic',
    getArchetypes: () => ARCHETYPES.map(a => ({
      id: a.id, name: a.name, description: a.name,
      defaultIdentity: { personality: a.traits.join(', '), backstory: '.', goals: a.goals, traits: a.traits },
    })),
    getInitialCharacters: () => chars,
    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        { definition: { name: 'move_to', description: 'Move to a location', parameters: [
          { name: 'location', type: 'string', description: 'Where to go', enum: LOCATIONS, required: true }
        ]}, executor: (args) => ({ success: true, result: `Moved to ${args.location}` }) },
        { definition: { name: 'talk_to', description: 'Talk to someone nearby', parameters: [
          { name: 'target', type: 'string', required: true, description: 'Who' },
          { name: 'content', type: 'string', required: true, description: 'What to say' },
        ]}, executor: (args) => ({ success: true, result: `Said to ${args.target}: ${args.content}` }) },
        { definition: { name: 'investigate', description: 'Investigate something in the area', parameters: [
          { name: 'subject', type: 'string', required: true, description: 'What to investigate' },
        ]}, executor: (args) => ({ success: true, result: `Investigated ${args.subject}` }) },
        { definition: { name: 'trade', description: 'Trade goods with someone', parameters: [
          { name: 'target', type: 'string', required: true, description: 'Trade partner' },
          { name: 'item', type: 'string', required: true, description: 'What to trade' },
        ]}, executor: (args) => ({ success: true, result: `Traded ${args.item} with ${args.target}` }) },
        { definition: { name: 'rest', description: 'Take a rest to recover energy', parameters: [] },
          executor: () => ({ success: true, result: 'Rested' }) },
        { definition: { name: 'craft', description: 'Craft an item', parameters: [
          { name: 'item', type: 'string', required: true, description: 'What to craft' },
        ]}, executor: (args) => ({ success: true, result: `Crafted ${args.item}` }) },
      ];
    },
    getGameState: () => ({
      worldTime: Date.now(), location: 'The Realm',
      nearbyEntities: chars.map(c => c.name),
      recentEvents: ['Morning in the village', 'Market day'],
      custom: { timePhase: 'morning', weather: 'clear' },
    }),
    getProprioception: (id) => ({
      currentAction: 'idle',
      location: LOCATIONS[parseInt(id.replace('char-', ''), 10) % LOCATIONS.length],
      inventory: ['basic_supplies'], status: ['healthy'], energy: 0.7 + Math.random() * 0.3,
    }),
    getWorldRules: () => 'Medieval fantasy world. Characters use tools to act. Be concise.',
    getEventTypes: () => ['combat', 'dialogue', 'trade', 'discovery'],
    filterEvent: () => true,
  };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        1B Model Diagnostic — Raw Output Analysis        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Health check
  try {
    const res = await fetch(`http://127.0.0.1:${VLLM_PORT}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error();
  } catch {
    console.log('  ERROR: vLLM not available'); process.exit(1);
  }

  // Try config file first, fall back to vLLM auto-detect
  let config: EngineConfig;
  let modelName = 'default';
  try {
    config = loadConfigFile();
    config.database = { path: ':memory:' };
    config.tick = { fastTickMs: 2000, slowTickMs: 20000, batchSize: 32 };
    config.logging = { level: 'error' };
    modelName = config.inference.models.heavy;
  } catch {
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
      tick: { fastTickMs: 2000, slowTickMs: 20000, batchSize: 32 },
      logging: { level: 'error' },
    };
  }
  console.log(`  Model: ${modelName}`);
  console.log(`  Characters: ${NUM_CHARS}\n`);

  const engine = new Engine(config);

  const decisions: RawDecision[] = [];
  const charArchetypes = new Map<string, string>();

  engine.events.on('agent:decision', (result: AgentDecisionResult) => {
    const actionType = 'toolName' in result.action ? 'tool'
      : result.action.type === 'dialogue' ? 'dialogue' : 'idle';
    decisions.push({
      characterId: result.characterId,
      archetype: charArchetypes.get(result.characterId) ?? '?',
      actionType,
      toolName: 'toolName' in result.action ? (result.action as any).toolName : undefined,
      rawOutput: result.reasoning ?? '',
      tokensUsed: result.tokensUsed,
      durationMs: result.durationMs,
    });
  });

  await engine.loadPlugin(createDiagPlugin());
  for (const c of engine.getAllCharacters()) {
    charArchetypes.set(c.id, c.archetype);
  }

  engine.start();

  // Inject 3 events to generate diverse decisions
  const events: GameEvent[] = [
    { type: 'discovery', source: 'world', data: { description: 'A mysterious stranger arrives at the village gates.' }, importance: 6, timestamp: Date.now() },
    { type: 'combat', source: 'bandits', data: { description: 'Bandits raid the marketplace!' }, importance: 8, timestamp: Date.now() },
    { type: 'trade', source: 'caravan', data: { description: 'A trade caravan offers exotic goods.' }, importance: 5, timestamp: Date.now() },
  ];

  for (const ev of events) {
    await engine.injectEvent({ ...ev, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 8000));
  }

  // Let one more tick cycle complete
  await new Promise(r => setTimeout(r, 10000));
  await engine.stop();

  // ── Analysis ──────────────────────────────────────────────

  const total = decisions.length;
  const toolDecs = decisions.filter(d => d.actionType === 'tool');
  const dialogueDecs = decisions.filter(d => d.actionType === 'dialogue');
  const idleDecs = decisions.filter(d => d.actionType === 'idle');

  console.log(`\n  Total decisions: ${total}`);
  console.log(`  Tool calls:  ${toolDecs.length} (${((toolDecs.length / total) * 100).toFixed(1)}%)`);
  console.log(`  Dialogue:    ${dialogueDecs.length} (${((dialogueDecs.length / total) * 100).toFixed(1)}%)`);
  console.log(`  Idle:        ${idleDecs.length} (${((idleDecs.length / total) * 100).toFixed(1)}%)`);

  // Categorize failures
  console.log('\n  ═══════════════════════════════════════════════════════');
  console.log('  DIALOGUE FALLBACK ANALYSIS');
  console.log('  ═══════════════════════════════════════════════════════\n');

  const dialogueCats = new Map<string, number>();
  for (const d of dialogueDecs) {
    const cat = categorize(d.rawOutput);
    dialogueCats.set(cat, (dialogueCats.get(cat) ?? 0) + 1);
  }

  const sortedCats = [...dialogueCats.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCats) {
    console.log(`  ${cat.padEnd(35)} ${count} (${((count / dialogueDecs.length) * 100).toFixed(1)}%)`);
  }

  // Show examples of each failure category
  console.log('\n  ═══════════════════════════════════════════════════════');
  console.log('  DIALOGUE SAMPLES (what the model actually said)');
  console.log('  ═══════════════════════════════════════════════════════\n');

  const shownCats = new Set<string>();
  for (const d of dialogueDecs) {
    const cat = categorize(d.rawOutput);
    if (shownCats.has(cat)) continue;
    shownCats.add(cat);
    const preview = d.rawOutput.slice(0, 200).replace(/\n/g, '\\n');
    console.log(`  [${cat}] (${d.archetype})`);
    console.log(`    "${preview}${d.rawOutput.length > 200 ? '...' : ''}"\n`);
  }

  // Idle analysis
  if (idleDecs.length > 0) {
    console.log('  ═══════════════════════════════════════════════════════');
    console.log('  IDLE FALLBACK ANALYSIS');
    console.log('  ═══════════════════════════════════════════════════════\n');

    const idleCats = new Map<string, number>();
    for (const d of idleDecs) {
      const cat = categorize(d.rawOutput);
      idleCats.set(cat, (idleCats.get(cat) ?? 0) + 1);
    }
    for (const [cat, count] of [...idleCats.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat.padEnd(35)} ${count}`);
    }

    console.log('\n  IDLE SAMPLES:\n');
    const shownIdleCats = new Set<string>();
    for (const d of idleDecs) {
      const cat = categorize(d.rawOutput);
      if (shownIdleCats.has(cat)) continue;
      shownIdleCats.add(cat);
      const preview = d.rawOutput.slice(0, 200).replace(/\n/g, '\\n');
      console.log(`  [${cat}] (${d.archetype})`);
      console.log(`    "${preview}${d.rawOutput.length > 200 ? '...' : ''}"\n`);
    }
  }

  // Tool hallucination check — tools that got used but aren't in the tool list
  console.log('  ═══════════════════════════════════════════════════════');
  console.log('  TOOL CALL ANALYSIS');
  console.log('  ═══════════════════════════════════════════════════════\n');

  const validTools = new Set(['move_to', 'talk_to', 'investigate', 'trade', 'rest', 'craft']);
  const toolUsage = new Map<string, number>();
  const hallucinated: string[] = [];
  for (const d of toolDecs) {
    if (d.toolName) {
      toolUsage.set(d.toolName, (toolUsage.get(d.toolName) ?? 0) + 1);
      if (!validTools.has(d.toolName)) hallucinated.push(d.toolName);
    }
  }

  for (const [name, count] of [...toolUsage.entries()].sort((a, b) => b[1] - a[1])) {
    const valid = validTools.has(name) ? '✓' : '✗ HALLUCINATED';
    console.log(`  ${name.padEnd(20)} ${count.toString().padEnd(5)} ${valid}`);
  }

  if (hallucinated.length > 0) {
    console.log(`\n  Hallucinated tools: ${[...new Set(hallucinated)].join(', ')}`);
  } else {
    console.log(`\n  No tool hallucinations detected.`);
  }

  // Token efficiency
  console.log('\n  ═══════════════════════════════════════════════════════');
  console.log('  TOKEN EFFICIENCY');
  console.log('  ═══════════════════════════════════════════════════════\n');

  const avgToolTokens = toolDecs.length > 0
    ? toolDecs.reduce((s, d) => s + d.tokensUsed, 0) / toolDecs.length : 0;
  const avgDialogueTokens = dialogueDecs.length > 0
    ? dialogueDecs.reduce((s, d) => s + d.tokensUsed, 0) / dialogueDecs.length : 0;
  const avgIdleTokens = idleDecs.length > 0
    ? idleDecs.reduce((s, d) => s + d.tokensUsed, 0) / idleDecs.length : 0;

  console.log(`  Avg tokens per tool call:   ${avgToolTokens.toFixed(0)}`);
  console.log(`  Avg tokens per dialogue:    ${avgDialogueTokens.toFixed(0)}`);
  console.log(`  Avg tokens per idle:        ${avgIdleTokens.toFixed(0)}`);
  console.log(`  Wasted tokens (idle+dialogue): ${(dialogueDecs.reduce((s, d) => s + d.tokensUsed, 0) + idleDecs.reduce((s, d) => s + d.tokensUsed, 0)).toLocaleString()}`);

  // Archetype breakdown
  console.log('\n  ═══════════════════════════════════════════════════════');
  console.log('  PER-ARCHETYPE TOOL CALL RATE');
  console.log('  ═══════════════════════════════════════════════════════\n');

  const archetypeStats = new Map<string, { total: number; tools: number; dialogue: number; idle: number }>();
  for (const d of decisions) {
    const stats = archetypeStats.get(d.archetype) ?? { total: 0, tools: 0, dialogue: 0, idle: 0 };
    stats.total++;
    if (d.actionType === 'tool') stats.tools++;
    else if (d.actionType === 'dialogue') stats.dialogue++;
    else stats.idle++;
    archetypeStats.set(d.archetype, stats);
  }

  for (const [arch, stats] of [...archetypeStats.entries()].sort((a, b) => b[1].tools / b[1].total - a[1].tools / a[1].total)) {
    const toolRate = ((stats.tools / stats.total) * 100).toFixed(0);
    const diagRate = ((stats.dialogue / stats.total) * 100).toFixed(0);
    const idleRate = ((stats.idle / stats.total) * 100).toFixed(0);
    console.log(`  ${arch.padEnd(15)} tool:${toolRate.padStart(3)}%  dialogue:${diagRate.padStart(3)}%  idle:${idleRate.padStart(3)}%  (n=${stats.total})`);
  }

  console.log('\n  Done.');
}

main().catch(console.error);
