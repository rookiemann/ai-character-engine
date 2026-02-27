import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '../../src/chat/ChatService';
import { MiddlewarePipeline } from '../../src/core/Middleware';
import { ProximityError, AgentError } from '../../src/core/errors';
import { makeChar, createMockRegistry, createMockEmitter, makeInferenceResponse } from '../helpers/factories';

function createMockChatHistory() {
  const messages: any[] = [];
  return {
    add: vi.fn().mockImplementation((charId: string, playerId: string, role: string, content: string) => {
      const msg = { id: `msg_${Date.now()}`, characterId: charId, playerId, role, content, createdAt: Date.now() };
      messages.push(msg);
      return msg;
    }),
    getRecent: vi.fn().mockReturnValue([]),
    _messages: messages,
  } as any;
}

function createMockMemory() {
  return {
    addWorkingMemory: vi.fn(),
    getContext: vi.fn().mockReturnValue({
      workingMemory: [],
      episodicMemories: [],
      characterSummary: null,
    }),
    recordEvent: vi.fn(),
  } as any;
}

function createMockInference() {
  return {
    complete: vi.fn().mockResolvedValue(makeInferenceResponse('Hello, adventurer!')),
  } as any;
}

function createMockProximity(canChat: boolean = true) {
  return {
    canChat: vi.fn().mockReturnValue(canChat),
    boostFromChat: vi.fn(),
  } as any;
}

describe('ChatService', () => {
  let chat: ChatService;
  let registry: any;
  let history: any;
  let memory: any;
  let inference: any;
  let proximity: any;
  let emitter: any;

  beforeEach(() => {
    const char = makeChar('c1', 'Kira');
    registry = createMockRegistry([char]);
    history = createMockChatHistory();
    memory = createMockMemory();
    inference = createMockInference();
    proximity = createMockProximity(true);
    emitter = createMockEmitter();
    chat = new ChatService(history, registry, memory, inference, proximity, emitter);
  });

  // --- Error cases ---

  it('should throw ProximityError when closeness too low', async () => {
    proximity.canChat.mockReturnValue(false);
    await expect(chat.sendMessage('c1', 'default', 'Hi')).rejects.toThrow(ProximityError);
  });

  it('should throw AgentError for unknown character', async () => {
    await expect(chat.sendMessage('ghost', 'default', 'Hi')).rejects.toThrow(AgentError);
  });

  // --- Happy path ---

  it('should record player message in history', async () => {
    await chat.sendMessage('c1', 'default', 'Hello!');
    expect(history.add).toHaveBeenCalledWith('c1', 'default', 'player', 'Hello!');
  });

  it('should call LLM and record response', async () => {
    const response = await chat.sendMessage('c1', 'default', 'How are you?');
    expect(inference.complete).toHaveBeenCalled();
    expect(response.content).toBe('Hello, adventurer!');
    expect(response.role).toBe('character');
  });

  it('should add to working memory', async () => {
    await chat.sendMessage('c1', 'default', 'Tell me something');
    // Called twice: once for player message, once for character response
    expect(memory.addWorkingMemory).toHaveBeenCalledTimes(2);
  });

  it('should boost proximity after chat', async () => {
    await chat.sendMessage('c1', 'default', 'Hi');
    expect(proximity.boostFromChat).toHaveBeenCalledWith('c1', 'default');
  });

  // --- Middleware ---

  it('should abort on beforeChat middleware abort', async () => {
    const mw = new MiddlewarePipeline();
    mw.use('beforeChat', async (ctx) => { ctx.abort = true; });
    chat.setMiddleware(mw);

    const response = await chat.sendMessage('c1', 'default', 'Hi');
    expect(response.content).toBe('');
    expect(inference.complete).not.toHaveBeenCalled();
  });

  it('should run afterChat middleware', async () => {
    let afterCalled = false;
    const mw = new MiddlewarePipeline();
    mw.use('afterChat', async (ctx, next) => { afterCalled = true; await next(); });
    chat.setMiddleware(mw);

    await chat.sendMessage('c1', 'default', 'Hi');
    expect(afterCalled).toBe(true);
  });

  it('should emit chat:message events', async () => {
    await chat.sendMessage('c1', 'default', 'Hi');
    const chatEvents = emitter.emitted.filter((e: any) => e.event === 'chat:message');
    // Should have 2: player message + character response
    expect(chatEvents.length).toBe(2);
  });
});
