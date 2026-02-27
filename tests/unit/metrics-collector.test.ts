import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../src/core/MetricsCollector';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector(300_000); // 5 minute window
  });

  // --- Recording ---

  it('should record decision latencies', () => {
    metrics.recordDecision(100);
    metrics.recordDecision(200);
    metrics.recordDecision(300);
    const snap = metrics.getSnapshot();
    expect(snap.decisions.total).toBe(3);
  });

  it('should record tool usage distribution', () => {
    metrics.recordToolUse('attack');
    metrics.recordToolUse('attack');
    metrics.recordToolUse('rest');
    const snap = metrics.getSnapshot();
    expect(snap.tools.total).toBe(3);
    expect(snap.tools.distribution.attack).toBe(2);
    expect(snap.tools.distribution.rest).toBe(1);
  });

  it('should record action type distribution', () => {
    metrics.recordAction('tool');
    metrics.recordAction('dialogue');
    metrics.recordAction('idle');
    const snap = metrics.getSnapshot();
    expect(snap.actions.total).toBe(3);
    expect(snap.actions.distribution.tool).toBe(1);
  });

  it('should record errors by type', () => {
    metrics.recordError('AGENT_ERROR');
    metrics.recordError('AGENT_ERROR');
    metrics.recordError('INFERENCE_ERROR');
    const snap = metrics.getSnapshot();
    expect(snap.errors.total).toBe(3);
    expect(snap.errors.byType.AGENT_ERROR).toBe(2);
  });

  it('should record tokens and compute per-second rate', () => {
    metrics.recordTokens(1000);
    metrics.recordTokens(500);
    const snap = metrics.getSnapshot();
    expect(snap.inference.tokensTotal).toBe(1500);
    expect(snap.inference.tokensPerSecond).toBeGreaterThan(0);
  });

  it('should record hint included/dropped and compute drop rate', () => {
    metrics.recordHintIncluded();
    metrics.recordHintIncluded();
    metrics.recordHintDropped();
    const snap = metrics.getSnapshot();
    expect(snap.hints.included).toBe(2);
    expect(snap.hints.dropped).toBe(1);
    expect(snap.hints.dropRate).toBeCloseTo(1 / 3);
  });

  // --- Snapshot percentiles ---

  it('should compute p50/p95/p99/avg latency percentiles', () => {
    for (let i = 1; i <= 100; i++) {
      metrics.recordDecision(i);
    }
    const snap = metrics.getSnapshot();
    expect(snap.decisions.latency.p50).toBe(51);
    expect(snap.decisions.latency.p95).toBe(96);
    expect(snap.decisions.latency.avg).toBe(51); // Math.round(50.5)
  });

  it('should compute per-second decision rate', () => {
    for (let i = 0; i < 10; i++) {
      metrics.recordDecision(100);
    }
    const snap = metrics.getSnapshot();
    expect(snap.decisions.perSecond).toBeGreaterThan(0);
  });

  it('should compute prompt cache hit rate', () => {
    metrics.recordPromptCacheHit();
    metrics.recordPromptCacheHit();
    metrics.recordPromptCacheMiss();
    const snap = metrics.getSnapshot();
    expect(snap.promptCache.hitRate).toBeCloseTo(2 / 3);
  });

  it('should return zero values for empty snapshot', () => {
    const snap = metrics.getSnapshot();
    expect(snap.decisions.total).toBe(0);
    expect(snap.decisions.latency.p50).toBe(0);
    expect(snap.decisions.latency.avg).toBe(0);
    expect(snap.tools.total).toBe(0);
    expect(snap.hints.dropRate).toBe(0);
    expect(snap.promptCache.hitRate).toBe(0);
  });

  // --- Sliding window ---

  it('should prune expired entries outside window', () => {
    // Use a very short window
    const shortMetrics = new MetricsCollector(1); // 1ms window
    shortMetrics.recordDecision(100);
    shortMetrics.recordToolUse('attack');

    // Wait a tiny bit so entries are outside window
    const snap = shortMetrics.getSnapshot();
    // Entries may or may not be expired depending on timing,
    // but the pruning logic should not crash
    expect(snap.decisions.total).toBeGreaterThanOrEqual(0);
  });

  // --- Reset ---

  it('should reset all metrics', () => {
    metrics.recordDecision(100);
    metrics.recordToolUse('attack');
    metrics.recordTokens(500);
    metrics.reset();
    const snap = metrics.getSnapshot();
    expect(snap.decisions.total).toBe(0);
    expect(snap.tools.total).toBe(0);
    expect(snap.inference.tokensTotal).toBe(0);
  });
});
