import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationManager } from '../../src/agent/ConversationManager';
import { makeChar, createMockRegistry, createMockEmitter, makeInferenceResponse } from '../helpers/factories';

function createMockMemory() {
  return {
    getContext: vi.fn().mockReturnValue({
      workingMemory: [],
      episodicMemories: [],
      characterSummary: null,
    }),
    addWorkingMemory: vi.fn(),
    recordEvent: vi.fn(),
  } as any;
}

function createMockInference() {
  let callCount = 0;
  return {
    complete: vi.fn().mockImplementation(async () => {
      callCount++;
      return makeInferenceResponse(`Reply ${callCount}`);
    }),
  } as any;
}

describe('ConversationManager', () => {
  let convManager: ConversationManager;
  let registry: any;
  let memory: any;
  let inference: any;
  let emitter: any;

  beforeEach(() => {
    const chars = [makeChar('c1', 'Alice'), makeChar('c2', 'Bob')];
    registry = createMockRegistry(chars);
    memory = createMockMemory();
    inference = createMockInference();
    emitter = createMockEmitter();
    convManager = new ConversationManager(registry, memory, inference, emitter);
  });

  it('should start a conversation with active status', async () => {
    const conv = await convManager.startConversation(['c1', 'c2'], 'weather');
    expect(conv.status).toBe('active');
    expect(conv.participantIds).toEqual(['c1', 'c2']);
    expect(conv.topic).toBe('weather');
    expect(conv.turns).toHaveLength(0);
  });

  it('should run one round with one turn per participant', async () => {
    const conv = await convManager.startConversation(['c1', 'c2'], 'plans', 10);
    const turns = await convManager.runRound(conv.id);
    expect(turns.length).toBe(2);
    expect(turns[0].characterId).toBe('c1');
    expect(turns[1].characterId).toBe('c2');
  });

  it('should respect maxTurns and complete conversation', async () => {
    const conv = await convManager.startConversation(['c1', 'c2'], 'plans', 3);
    await convManager.runRound(conv.id); // 2 turns
    await convManager.runRound(conv.id); // 1 turn (hits maxTurns)
    expect(conv.status).toBe('completed');
    expect(conv.turns.length).toBe(3);
  });

  it('should record working memory for each participant', async () => {
    const conv = await convManager.startConversation(['c1', 'c2'], 'plans', 10);
    await convManager.runRound(conv.id);
    expect(memory.addWorkingMemory).toHaveBeenCalled();
  });

  it('should run full conversation to completion', async () => {
    const conv = await convManager.startConversation(['c1', 'c2'], 'battle plan', 4);
    const result = await convManager.runFull(conv.id);
    expect(result.status).toBe('completed');
    expect(result.turns.length).toBe(4);
  });

  it('should record episodic memory after runFull', async () => {
    const conv = await convManager.startConversation(['c1', 'c2'], 'trade', 2);
    await convManager.runFull(conv.id);
    expect(memory.recordEvent).toHaveBeenCalled();
  });

  it('should retrieve conversation by get()', async () => {
    const conv = await convManager.startConversation(['c1', 'c2'], 'test');
    const retrieved = convManager.get(conv.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(conv.id);
  });

  it('should return active conversations via getActive()', async () => {
    await convManager.startConversation(['c1', 'c2'], 'active1');
    const conv2 = await convManager.startConversation(['c1', 'c2'], 'active2', 2);
    await convManager.runFull(conv2.id);

    const active = convManager.getActive();
    expect(active.length).toBe(1);
    expect(active[0].topic).toBe('active1');
  });
});
