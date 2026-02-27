import { getLogger } from './logger';

/**
 * Sliding-window metrics collector for engine observability.
 * Tracks decision latencies, tool usage, error rates, and custom counters.
 * All data is in-memory with configurable time windows.
 */

interface LatencyEntry {
  value: number;
  timestamp: number;
}

interface CounterEntry {
  key: string;
  timestamp: number;
}

export interface MetricsSnapshot {
  decisions: {
    total: number;
    perSecond: number;
    latency: { p50: number; p95: number; p99: number; avg: number };
  };
  tools: {
    total: number;
    distribution: Record<string, number>;
  };
  actions: {
    total: number;
    distribution: Record<string, number>;  // dialogue vs tool vs idle
  };
  errors: {
    total: number;
    byType: Record<string, number>;
  };
  inference: {
    tokensTotal: number;
    tokensPerSecond: number;
    providerErrors: Record<string, number>;
    circuitBreaks: number;
  };
  hints: {
    included: number;
    dropped: number;
    dropRate: number;
  };
  memory: {
    retrievals: number;
    semanticAugmentations: number;
    consolidations: number;
  };
  promptCache: {
    hits: number;
    misses: number;
    hitRate: number;
  };
  uptime: number;
  windowMs: number;
}

export class MetricsCollector {
  private log = getLogger('metrics');
  private startTime = Date.now();
  private windowMs: number;

  // Latency tracking
  private decisionLatencies: LatencyEntry[] = [];

  // Counter tracking
  private counters = new Map<string, CounterEntry[]>();

  // Accumulator tracking (tokens, etc.)
  private accumulators = new Map<string, number>();

  constructor(windowMs: number = 300_000) { // Default: 5 minute window
    this.windowMs = windowMs;
  }

  // --- Recording methods ---

  recordDecision(durationMs: number): void {
    this.decisionLatencies.push({ value: durationMs, timestamp: Date.now() });
  }

  recordToolUse(toolName: string): void {
    this.incrementCounter(`tool:${toolName}`);
  }

  recordAction(actionType: string): void {
    this.incrementCounter(`action:${actionType}`);
  }

  recordError(errorType: string): void {
    this.incrementCounter(`error:${errorType}`);
  }

  recordProviderError(providerName: string): void {
    this.incrementCounter(`provider_error:${providerName}`);
  }

  recordCircuitBreak(): void {
    this.incrementCounter('circuit_break');
  }

  recordTokens(count: number): void {
    this.addToAccumulator('tokens', count);
  }

  recordHintIncluded(): void {
    this.incrementCounter('hint:included');
  }

  recordHintDropped(): void {
    this.incrementCounter('hint:dropped');
  }

  recordMemoryRetrieval(): void {
    this.incrementCounter('memory:retrieval');
  }

  recordSemanticAugmentation(): void {
    this.incrementCounter('memory:semantic');
  }

  recordConsolidation(): void {
    this.incrementCounter('memory:consolidation');
  }

  recordPromptCacheHit(): void {
    this.incrementCounter('cache:hit');
  }

  recordPromptCacheMiss(): void {
    this.incrementCounter('cache:miss');
  }

  // --- Custom counters ---

  recordCustom(key: string, value?: number): void {
    if (value !== undefined) {
      this.addToAccumulator(`custom:${key}`, value);
    } else {
      this.incrementCounter(`custom:${key}`);
    }
  }

  // --- Snapshot ---

  /**
   * Generate a point-in-time metrics snapshot for the current window.
   */
  getSnapshot(): MetricsSnapshot {
    const now = Date.now();
    this.pruneExpired(now);

    const windowSeconds = this.windowMs / 1000;

    // Decision latencies
    const latencies = this.decisionLatencies.map(e => e.value);
    const decisionTotal = latencies.length;

    // Tool distribution
    const toolDist: Record<string, number> = {};
    let toolTotal = 0;
    for (const [key, entries] of this.counters) {
      if (key.startsWith('tool:')) {
        const name = key.slice(5);
        toolDist[name] = entries.length;
        toolTotal += entries.length;
      }
    }

    // Action distribution
    const actionDist: Record<string, number> = {};
    let actionTotal = 0;
    for (const [key, entries] of this.counters) {
      if (key.startsWith('action:')) {
        const name = key.slice(7);
        actionDist[name] = entries.length;
        actionTotal += entries.length;
      }
    }

    // Errors
    const errorDist: Record<string, number> = {};
    let errorTotal = 0;
    for (const [key, entries] of this.counters) {
      if (key.startsWith('error:')) {
        const name = key.slice(6);
        errorDist[name] = entries.length;
        errorTotal += entries.length;
      }
    }

    // Provider errors
    const providerErrors: Record<string, number> = {};
    for (const [key, entries] of this.counters) {
      if (key.startsWith('provider_error:')) {
        providerErrors[key.slice(15)] = entries.length;
      }
    }

    // Hints
    const hintsIncluded = this.getCount('hint:included');
    const hintsDropped = this.getCount('hint:dropped');
    const hintTotal = hintsIncluded + hintsDropped;

    // Memory
    const retrievals = this.getCount('memory:retrieval');
    const semantic = this.getCount('memory:semantic');
    const consolidations = this.getCount('memory:consolidation');

    // Cache
    const cacheHits = this.getCount('cache:hit');
    const cacheMisses = this.getCount('cache:miss');
    const cacheTotal = cacheHits + cacheMisses;

    const tokens = this.accumulators.get('tokens') ?? 0;

    return {
      decisions: {
        total: decisionTotal,
        perSecond: decisionTotal / windowSeconds,
        latency: this.computePercentiles(latencies),
      },
      tools: {
        total: toolTotal,
        distribution: toolDist,
      },
      actions: {
        total: actionTotal,
        distribution: actionDist,
      },
      errors: {
        total: errorTotal,
        byType: errorDist,
      },
      inference: {
        tokensTotal: tokens,
        tokensPerSecond: tokens / windowSeconds,
        providerErrors,
        circuitBreaks: this.getCount('circuit_break'),
      },
      hints: {
        included: hintsIncluded,
        dropped: hintsDropped,
        dropRate: hintTotal > 0 ? hintsDropped / hintTotal : 0,
      },
      memory: {
        retrievals,
        semanticAugmentations: semantic,
        consolidations,
      },
      promptCache: {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: cacheTotal > 0 ? cacheHits / cacheTotal : 0,
      },
      uptime: now - this.startTime,
      windowMs: this.windowMs,
    };
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.decisionLatencies = [];
    this.counters.clear();
    this.accumulators.clear();
    this.startTime = Date.now();
  }

  // --- Internal ---

  private incrementCounter(key: string): void {
    if (!this.counters.has(key)) {
      this.counters.set(key, []);
    }
    this.counters.get(key)!.push({ key, timestamp: Date.now() });
  }

  private addToAccumulator(key: string, value: number): void {
    this.accumulators.set(key, (this.accumulators.get(key) ?? 0) + value);
  }

  private getCount(key: string): number {
    return this.counters.get(key)?.length ?? 0;
  }

  private pruneExpired(now: number): void {
    const cutoff = now - this.windowMs;

    // Prune latencies
    this.decisionLatencies = this.decisionLatencies.filter(e => e.timestamp >= cutoff);

    // Prune counters
    for (const [key, entries] of this.counters) {
      const pruned = entries.filter(e => e.timestamp >= cutoff);
      if (pruned.length === 0) {
        this.counters.delete(key);
      } else {
        this.counters.set(key, pruned);
      }
    }
  }

  private computePercentiles(values: number[]): { p50: number; p95: number; p99: number; avg: number } {
    if (values.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;

    return {
      p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      avg: Math.round(avg),
    };
  }
}
