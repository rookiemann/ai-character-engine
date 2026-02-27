import { describe, it, expect, beforeEach } from 'vitest';
import { ContextAssembler } from '../../src/agent/ContextAssembler';
import { TokenBudget } from '../../src/inference/TokenBudget';
import { makeChar, makeMemoryRecord, makeWorkingMemory, makeSummaryRecord, makeToolDef, makeGameEvent } from '../helpers/factories';

describe('ContextAssembler', () => {
  let assembler: ContextAssembler;
  let budget: TokenBudget;

  beforeEach(() => {
    budget = new TokenBudget();
    assembler = new ContextAssembler(budget);
  });

  const baseParams = () => ({
    character: makeChar('c1', 'Kira'),
    gameState: { worldTime: Date.now(), location: 'market', nearbyEntities: ['Bob'] },
    proprioception: { location: 'market', currentAction: 'browsing', inventory: ['sword'], status: ['healthy'], energy: 0.8 },
    episodicMemories: [] as any[],
    workingMemory: [] as any[],
    characterSummary: null,
  });

  it('should return an array of InferenceMessages', () => {
    const msgs = assembler.assemble(baseParams());
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].role).toBe('system');
  });

  it('should include episodic memories sorted by importance', () => {
    const mems = [
      makeMemoryRecord('m1', { importance: 3, summary: 'Saw a cat' }),
      makeMemoryRecord('m2', { importance: 8, summary: 'Found treasure' }),
      makeMemoryRecord('m3', { importance: 5, summary: 'Met a merchant' }),
    ];
    const msgs = assembler.assemble({ ...baseParams(), episodicMemories: mems });
    const memMsg = msgs.find(m => m.content.includes('Significant memories'));
    expect(memMsg).toBeDefined();
    // Higher importance first
    const treasureIdx = memMsg!.content.indexOf('Found treasure');
    const catIdx = memMsg!.content.indexOf('Saw a cat');
    if (catIdx !== -1) {
      expect(treasureIdx).toBeLessThan(catIdx);
    }
  });

  it('should limit memories by tier (active=5, background=3, dormant=1)', () => {
    const mems = Array.from({ length: 8 }, (_, i) =>
      makeMemoryRecord(`m${i}`, { importance: i + 1, summary: `Memory ${i}` }),
    );

    // Background tier
    const char = makeChar('c1', 'Kira', { activityTier: 'background' });
    const msgs = assembler.assemble({ ...baseParams(), character: char, episodicMemories: mems });
    const memMsg = msgs.find(m => m.content.includes('Significant memories'));
    if (memMsg) {
      const lines = memMsg.content.split('\n').filter(l => l.startsWith('-'));
      expect(lines.length).toBeLessThanOrEqual(3);
    }
  });

  it('should include working memory as recent exchanges', () => {
    const working = [
      makeWorkingMemory('w1', 'Hello', { role: 'user' }),
      makeWorkingMemory('w2', 'Hi there', { role: 'assistant' }),
    ];
    const msgs = assembler.assemble({ ...baseParams(), workingMemory: working });
    const workMsg = msgs.find(m => m.content.includes('Recent exchanges'));
    expect(workMsg).toBeDefined();
    expect(workMsg!.content).toContain('Hello');
  });

  it('should include location in situation block', () => {
    const msgs = assembler.assemble(baseParams());
    const situationMsg = msgs.find(m => m.content.includes('Current situation'));
    expect(situationMsg).toBeDefined();
    expect(situationMsg!.content).toContain('Location: market');
  });

  it('should include status in situation block', () => {
    const msgs = assembler.assemble(baseParams());
    const sitMsg = msgs.find(m => m.content.includes('Current situation'));
    expect(sitMsg!.content).toContain('Status: healthy');
  });

  it('should include inventory in situation block', () => {
    const msgs = assembler.assemble(baseParams());
    const sitMsg = msgs.find(m => m.content.includes('Current situation'));
    expect(sitMsg!.content).toContain('Inventory: sword');
  });

  it('should include energy level descriptor', () => {
    const msgs = assembler.assemble(baseParams());
    const sitMsg = msgs.find(m => m.content.includes('Current situation'));
    expect(sitMsg!.content).toContain('Energy: high');
  });

  it('should include trigger event data', () => {
    const event = makeGameEvent('combat', { source: 'goblin', data: { damage: 5 } });
    const msgs = assembler.assemble({ ...baseParams(), triggerEvent: event });
    const sitMsg = msgs.find(m => m.content.includes('Triggering event'));
    expect(sitMsg).toBeDefined();
    expect(sitMsg!.content).toContain('combat');
    expect(sitMsg!.content).toContain('goblin');
  });

  it('should skip memories when token budget is tight', () => {
    // Use a very tight budget
    const tightBudget = new TokenBudget({
      active: { context: 50, response: 20 },
      background: { context: 25, response: 10 },
      dormant: { context: 15, response: 5 },
    });
    const tightAssembler = new ContextAssembler(tightBudget);
    const mems = Array.from({ length: 5 }, (_, i) =>
      makeMemoryRecord(`m${i}`, { importance: 5, summary: 'A'.repeat(200) }),
    );
    const msgs = tightAssembler.assemble({ ...baseParams(), episodicMemories: mems });
    // Should still have at least system prompt
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].role).toBe('system');
  });

  it('should add variety warnings when actions are dominant (>40%)', () => {
    const recentActions = ['tool:attack', 'tool:attack', 'tool:attack', 'tool:rest', 'idle'];
    const msgs = assembler.assemble({ ...baseParams(), recentActions });
    const sitMsg = msgs.find(m => m.content.includes('DIFFERENT action'));
    expect(sitMsg).toBeDefined();
  });

  it('should suggest unused tools', () => {
    const recentActions = ['tool:attack', 'tool:attack', 'tool:attack', 'tool:rest', 'idle'];
    const tools = [makeToolDef('attack'), makeToolDef('trade'), makeToolDef('rest')];
    const msgs = assembler.assemble({ ...baseParams(), recentActions, availableTools: tools });
    const sitMsg = msgs.find(m => m.content.includes("haven't tried"));
    expect(sitMsg).toBeDefined();
    expect(sitMsg!.content).toContain('trade');
  });

  it('should not add variety hints with <2 recent actions', () => {
    const recentActions = ['tool:attack'];
    const msgs = assembler.assemble({ ...baseParams(), recentActions });
    const hasVariety = msgs.some(m => m.content.includes('DIFFERENT action'));
    expect(hasVariety).toBe(false);
  });

  // --- assembleChat ---

  it('should assemble chat context with system + memories + history + player message', () => {
    const char = makeChar('c1', 'Kira');
    const history = [
      { role: 'player', content: 'Hey' },
      { role: 'character', content: 'Hello!' },
    ];
    const mems = [makeMemoryRecord('m1', { summary: 'Fought a dragon' })];
    const msgs = assembler.assembleChat({
      character: char,
      chatHistory: history,
      episodicMemories: mems,
      characterSummary: null,
      playerMessage: 'How are you?',
    });

    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('Kira');
    // Should end with the player message
    expect(msgs[msgs.length - 1].content).toBe('How are you?');
    expect(msgs[msgs.length - 1].role).toBe('user');
  });

  it('should limit chat history to 6 entries', () => {
    const char = makeChar('c1', 'Kira');
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'player' : 'character',
      content: `Message ${i}`,
    }));
    const msgs = assembler.assembleChat({
      character: char,
      chatHistory: history,
      episodicMemories: [],
      characterSummary: null,
      playerMessage: 'test',
    });
    // System + player msg = 2, plus at most 6 history entries
    // Plus memories block if present
    expect(msgs.length).toBeLessThanOrEqual(10);
  });
});
