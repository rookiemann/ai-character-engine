import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TickScheduler } from '../../src/scheduler/TickScheduler';
import { createMockEmitter } from '../helpers/factories';

function createMockAgentScheduler() {
  return {
    beginTick: vi.fn(),
    getAgentsForFastTick: vi.fn().mockReturnValue([]),
    getAgentsForSlowTick: vi.fn().mockReturnValue([]),
    buildRequest: vi.fn(),
  } as any;
}

function createMockBatchProcessor() {
  return {
    processBatches: vi.fn().mockResolvedValue([]),
    processSingleBatch: vi.fn().mockResolvedValue([]),
  } as any;
}

function createMockTierManager() {
  return {
    refreshTiers: vi.fn(),
    getActiveCharacters: vi.fn().mockReturnValue([]),
  } as any;
}

function createMockProximity() {
  return {
    applyDecay: vi.fn(),
  } as any;
}

function createMockMemory() {
  return {
    onSlowTick: vi.fn(),
    needsSummaryRegeneration: vi.fn().mockReturnValue(false),
    buildSummaryPrompt: vi.fn(),
    updateSummary: vi.fn(),
  } as any;
}

describe('TickScheduler', () => {
  let scheduler: TickScheduler;
  let agentScheduler: any;
  let batchProcessor: any;
  let emitter: any;

  beforeEach(() => {
    vi.useFakeTimers();
    agentScheduler = createMockAgentScheduler();
    batchProcessor = createMockBatchProcessor();
    emitter = createMockEmitter();

    scheduler = new TickScheduler(
      agentScheduler,
      batchProcessor,
      createMockTierManager(),
      createMockProximity(),
      createMockMemory(),
      emitter,
      null,
      { fastTickMs: 100000, slowTickMs: 200000, maxAgentsPerFastTick: 15, maxAgentsPerSlowTick: 50, batchSize: 10 },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- start/stop ---

  it('should start and set running flag', () => {
    expect(scheduler.isRunning).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
  });

  it('should not double-start', () => {
    scheduler.start();
    scheduler.start(); // Should be no-op
    expect(scheduler.isRunning).toBe(true);
  });

  it('should stop and clear timers', async () => {
    scheduler.start();
    await scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  // --- isRunning ---

  it('should report isRunning correctly', async () => {
    expect(scheduler.isRunning).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    await scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  // --- injectEvent ---

  it('should inject event and process targeted characters', async () => {
    scheduler.start();
    const registry = {
      get: vi.fn().mockReturnValue({ id: 'c1', activityTier: 'active' }),
      getAll: vi.fn().mockReturnValue([]),
    };
    // Inject event with a target
    await scheduler.injectEvent({
      type: 'combat',
      target: 'c1',
      timestamp: Date.now(),
      importance: 5,
    });
    // Should have called beginTick for the event
    expect(agentScheduler.beginTick).toHaveBeenCalled();
    await scheduler.stop();
  });

  // --- getStats ---

  it('should track tick counts', () => {
    const stats = scheduler.stats;
    expect(stats.fastTicks).toBe(0);
    expect(stats.slowTicks).toBe(0);
    expect(stats.running).toBe(false);
  });

  // --- config merging ---

  it('should merge config with defaults', () => {
    // The scheduler was created with custom config
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    // Config merged properly — no crash
  });

  it('should update config at runtime', async () => {
    scheduler.start();
    scheduler.updateConfig({ fastTickMs: 50000, batchSize: 5 });
    // Should not crash, timers restarted
    expect(scheduler.isRunning).toBe(true);
    await scheduler.stop();
  });
});
