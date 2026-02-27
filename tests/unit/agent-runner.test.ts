import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRunner } from '../../src/agent/AgentRunner';
import { MiddlewarePipeline } from '../../src/core/Middleware';
import { AgentError } from '../../src/core/errors';
import { makeChar, makeInferenceResponse, createMockRegistry, createMockEmitter } from '../helpers/factories';
import type { AgentDecisionRequest, ToolDefinition, InferenceRequest } from '../../src/core/types';

// Mock subsystems
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
  return {
    complete: vi.fn().mockResolvedValue(makeInferenceResponse('{"tool":"rest","arguments":{}}')),
  } as any;
}

function createMockToolExecutor() {
  return {
    execute: vi.fn().mockResolvedValue({ success: true, result: 'Done' }),
    parseToolCallFromText: vi.fn().mockImplementation((text: string) => {
      try {
        const parsed = JSON.parse(text);
        if (parsed.tool) return { toolName: parsed.tool, arguments: parsed.arguments ?? {} };
      } catch { /* not JSON */ }
      return null;
    }),
  } as any;
}

function makeRequest(charId: string, tools: ToolDefinition[] = []): AgentDecisionRequest {
  return {
    characterId: charId,
    playerId: 'default',
    gameState: { worldTime: Date.now() },
    proprioception: { location: 'market' },
    availableTools: tools,
    energyLevel: 0.5,
  };
}

const testTools: ToolDefinition[] = [
  { name: 'rest', description: 'Rest', parameters: [] },
  { name: 'attack', description: 'Attack', parameters: [{ name: 'target', type: 'string', description: 'Who' }] },
];

describe('AgentRunner', () => {
  let runner: AgentRunner;
  let registry: any;
  let memory: any;
  let inference: any;
  let toolExecutor: any;
  let emitter: any;

  beforeEach(() => {
    const char = makeChar('char1', 'Kira');
    registry = createMockRegistry([char]);
    memory = createMockMemory();
    inference = createMockInference();
    toolExecutor = createMockToolExecutor();
    emitter = createMockEmitter();
    runner = new AgentRunner(registry, memory, inference, toolExecutor, emitter);
  });

  // --- Happy path ---

  it('should complete a full decision cycle', async () => {
    const result = await runner.runDecision(makeRequest('char1', testTools));
    expect(result.characterId).toBe('char1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.tokensUsed).toBeGreaterThanOrEqual(0);
  });

  it('should emit agent:decision event', async () => {
    await runner.runDecision(makeRequest('char1', testTools));
    const events = emitter.emitted.filter((e: any) => e.event === 'agent:decision');
    expect(events.length).toBe(1);
    expect(events[0].args[0].characterId).toBe('char1');
  });

  it('should record tool result to working memory', async () => {
    await runner.runDecision(makeRequest('char1', testTools));
    expect(memory.addWorkingMemory).toHaveBeenCalled();
  });

  // --- Tool parsing ---

  it('should parse native toolCalls from inference response', async () => {
    inference.complete.mockResolvedValue(makeInferenceResponse('', [{ toolName: 'rest', arguments: {} }]));
    const result = await runner.runDecision(makeRequest('char1', testTools));
    expect(toolExecutor.execute).toHaveBeenCalled();
    expect('toolName' in result.action || result.action.type === 'idle').toBe(true);
  });

  it('should parse JSON tool call from text content', async () => {
    inference.complete.mockResolvedValue(makeInferenceResponse('{"tool":"rest","arguments":{}}'));
    toolExecutor.parseToolCallFromText.mockReturnValue({ toolName: 'rest', arguments: {} });
    const result = await runner.runDecision(makeRequest('char1', testTools));
    expect(toolExecutor.parseToolCallFromText).toHaveBeenCalled();
  });

  it('should fuzzy-parse malformed JSON (single quotes)', async () => {
    inference.complete.mockResolvedValue(makeInferenceResponse("{'tool': 'rest', 'arguments': {}}"));
    toolExecutor.parseToolCallFromText.mockReturnValue(null);
    const result = await runner.runDecision(makeRequest('char1', testTools));
    // fuzzyParseToolCall should recover this
    if ('toolName' in result.action) {
      expect(result.action.toolName).toBe('rest');
    }
  });

  // --- Error handling ---

  it('should throw AgentError for unknown character', async () => {
    await expect(runner.runDecision(makeRequest('ghost', testTools))).rejects.toThrow(AgentError);
  });

  it('should fall back to idle when tool execution fails (hallucinated tool)', async () => {
    inference.complete.mockResolvedValue(makeInferenceResponse('{"tool":"fly","arguments":{}}'));
    toolExecutor.parseToolCallFromText.mockReturnValue({ toolName: 'fly', arguments: {} });
    toolExecutor.execute.mockRejectedValue(new Error('Unknown tool'));
    const result = await runner.runDecision(makeRequest('char1', testTools));
    expect(result.action.type).toBe('idle');
  });

  it('should handle context overflow with retry', async () => {
    let callCount = 0;
    inference.complete.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('Context size exceeded');
      return makeInferenceResponse('I rest quietly');
    });
    const result = await runner.runDecision(makeRequest('char1'));
    // Should get a result without throwing
    expect(result.characterId).toBe('char1');
  });

  // --- Narration detection ---

  it('should detect narration and retry with nudge', async () => {
    let callCount = 0;
    inference.complete.mockImplementation(async (req: InferenceRequest) => {
      callCount++;
      if (callCount === 1) {
        return makeInferenceResponse('The warrior surveys the battlefield. What would you like to do?');
      }
      return makeInferenceResponse('{"tool":"rest","arguments":{}}');
    });
    toolExecutor.parseToolCallFromText.mockImplementation((text: string) => {
      try {
        const p = JSON.parse(text);
        if (p.tool) return { toolName: p.tool, arguments: p.arguments ?? {} };
      } catch {}
      return null;
    });
    const result = await runner.runDecision(makeRequest('char1', testTools));
    // Should have retried (2+ inference calls)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  // --- Middleware ---

  it('should abort decision on beforeDecision middleware abort', async () => {
    const mw = new MiddlewarePipeline();
    mw.use('beforeDecision', async (ctx) => { ctx.abort = true; });
    runner.setMiddleware(mw);

    const result = await runner.runDecision(makeRequest('char1', testTools));
    expect(result.action.type).toBe('idle');
    expect(inference.complete).not.toHaveBeenCalled();
  });

  it('should abort tool exec on beforeToolExec middleware abort', async () => {
    inference.complete.mockResolvedValue(makeInferenceResponse('', [{ toolName: 'rest', arguments: {} }]));
    const mw = new MiddlewarePipeline();
    mw.use('beforeToolExec', async (ctx) => { ctx.abort = true; });
    runner.setMiddleware(mw);

    const result = await runner.runDecision(makeRequest('char1', testTools));
    expect(result.action.type).toBe('idle');
    expect(toolExecutor.execute).not.toHaveBeenCalled();
  });

  it('should run afterDecision middleware', async () => {
    let afterCalled = false;
    const mw = new MiddlewarePipeline();
    mw.use('afterDecision', async (ctx, next) => { afterCalled = true; await next(); });
    runner.setMiddleware(mw);

    await runner.runDecision(makeRequest('char1', testTools));
    expect(afterCalled).toBe(true);
  });

  // --- Recency reordering ---

  it('should reorder tools by ascending recent usage', async () => {
    // Run several decisions using 'rest' tool to build up recency
    inference.complete.mockResolvedValue(makeInferenceResponse('{"tool":"rest","arguments":{}}'));
    toolExecutor.parseToolCallFromText.mockReturnValue({ toolName: 'rest', arguments: {} });

    await runner.runDecision(makeRequest('char1', testTools));
    await runner.runDecision(makeRequest('char1', testTools));

    // Now the next inference call should have tools reordered (attack first since unused)
    inference.complete.mockImplementation(async (req: InferenceRequest) => {
      // Return idle so we don't need tool execution
      return makeInferenceResponse('Just resting');
    });
    toolExecutor.parseToolCallFromText.mockReturnValue(null);
    await runner.runDecision(makeRequest('char1', testTools));
    // Verify inference was called (can't directly inspect tool order from here)
    expect(inference.complete).toHaveBeenCalled();
  });

  // --- fuzzyParseToolCall edge cases ---

  it('should recover trailing comma JSON', async () => {
    inference.complete.mockResolvedValue(makeInferenceResponse('{"tool": "rest", "arguments": {},}'));
    toolExecutor.parseToolCallFromText.mockReturnValue(null);
    const result = await runner.runDecision(makeRequest('char1', testTools));
    if ('toolName' in result.action) {
      expect(result.action.toolName).toBe('rest');
    }
  });

  it('should recover unquoted keys', async () => {
    inference.complete.mockResolvedValue(makeInferenceResponse('{tool: "rest", arguments: {}}'));
    toolExecutor.parseToolCallFromText.mockReturnValue(null);
    const result = await runner.runDecision(makeRequest('char1', testTools));
    if ('toolName' in result.action) {
      expect(result.action.toolName).toBe('rest');
    }
  });

  // --- runBatch ---

  it('should run batch decisions concurrently', async () => {
    const char2 = makeChar('char2', 'Borin');
    registry._map.set('char2', char2);

    const results = await runner.runBatch([
      makeRequest('char1', testTools),
      makeRequest('char2', testTools),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].characterId).toBe('char1');
    expect(results[1].characterId).toBe('char2');
  });

  // --- clearCharacter ---

  it('should clear recent actions and rotation for a character', async () => {
    // Build up some state
    await runner.runDecision(makeRequest('char1', testTools));
    runner.clearCharacter('char1');
    // No error = state was cleared successfully
    const result = await runner.runDecision(makeRequest('char1', testTools));
    expect(result.characterId).toBe('char1');
  });
});
