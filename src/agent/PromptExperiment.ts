import { getLogger } from '../core/logger';

/**
 * Prompt A/B Testing Framework
 *
 * Register multiple prompt variants, assign them randomly per decision,
 * and track which variants produce better outcomes (tool variety,
 * action diversity, response quality).
 *
 * Usage:
 *   const experiment = new PromptExperiment();
 *   experiment.registerVariant('control', { instructionSuffix: '' });
 *   experiment.registerVariant('action-bias', { instructionSuffix: 'Always prefer actions over idle.' });
 *
 *   // In decision loop:
 *   const variant = experiment.assign(characterId, decisionId);
 *   // ... build prompt with variant.config ...
 *   experiment.recordOutcome(decisionId, { actionType: 'tool', toolName: 'trade' });
 */

export interface PromptVariant {
  name: string;
  weight: number;              // Relative probability weight (default 1)
  config: PromptVariantConfig;
}

export interface PromptVariantConfig {
  /** Extra text appended to the instructions section */
  instructionSuffix?: string;
  /** Override max hints for this variant */
  maxHints?: number;
  /** Override hint priority order (list of PromptExtension keys) */
  hintPriority?: string[];
  /** Override temperature for inference */
  temperature?: number;
  /** Custom key-value overrides for experimentation */
  custom?: Record<string, unknown>;
}

export interface ExperimentOutcome {
  actionType: string;     // 'dialogue' | 'idle' | tool name
  toolName?: string;
  durationMs?: number;
  tokensUsed?: number;
}

interface VariantStats {
  assignments: number;
  outcomes: ExperimentOutcome[];
  toolNames: Set<string>;
  actionTypes: Map<string, number>;
}

export interface ExperimentReport {
  variants: Array<{
    name: string;
    assignments: number;
    toolVariety: number;       // unique tool names used
    actionDistribution: Record<string, number>;
    avgDurationMs: number;
    avgTokens: number;
    toolRate: number;          // % of decisions that used a tool
    idleRate: number;          // % of decisions that were idle
  }>;
  totalDecisions: number;
  isActive: boolean;
}

export class PromptExperiment {
  private log = getLogger('prompt-experiment');
  private variants: PromptVariant[] = [];
  private totalWeight = 0;
  private stats = new Map<string, VariantStats>();
  private assignments = new Map<string, string>();  // decisionId → variantName
  private active = false;

  /**
   * Register a prompt variant for testing.
   */
  registerVariant(name: string, config: PromptVariantConfig, weight: number = 1): void {
    this.variants.push({ name, weight, config });
    this.totalWeight += weight;
    this.stats.set(name, {
      assignments: 0,
      outcomes: [],
      toolNames: new Set(),
      actionTypes: new Map(),
    });
    this.log.info({ variant: name, weight }, 'Prompt variant registered');
  }

  /**
   * Start the experiment. Must have at least 2 variants.
   */
  start(): void {
    if (this.variants.length < 2) {
      this.log.warn('Need at least 2 variants to run experiment');
      return;
    }
    this.active = true;
    this.log.info({ variants: this.variants.map(v => v.name) }, 'Experiment started');
  }

  /**
   * Stop the experiment.
   */
  stop(): void {
    this.active = false;
    this.log.info('Experiment stopped');
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Assign a variant for a decision. Returns null if experiment isn't active.
   * Uses weighted random selection.
   */
  assign(characterId: string, decisionId: string): PromptVariant | null {
    if (!this.active || this.variants.length === 0) return null;

    // Weighted random selection
    let roll = Math.random() * this.totalWeight;
    let selected = this.variants[0];
    for (const variant of this.variants) {
      roll -= variant.weight;
      if (roll <= 0) {
        selected = variant;
        break;
      }
    }

    this.assignments.set(decisionId, selected.name);
    const stat = this.stats.get(selected.name)!;
    stat.assignments++;

    return selected;
  }

  /**
   * Record the outcome of a decision for its assigned variant.
   */
  recordOutcome(decisionId: string, outcome: ExperimentOutcome): void {
    const variantName = this.assignments.get(decisionId);
    if (!variantName) return;

    const stat = this.stats.get(variantName);
    if (!stat) return;

    stat.outcomes.push(outcome);
    if (outcome.toolName) stat.toolNames.add(outcome.toolName);

    const count = stat.actionTypes.get(outcome.actionType) ?? 0;
    stat.actionTypes.set(outcome.actionType, count + 1);

    // Clean up assignment (keep memory bounded)
    this.assignments.delete(decisionId);
  }

  /**
   * Get the current variant assignment for a character if experiment is active.
   * Returns null if no experiment or character not assigned.
   */
  getActiveVariant(decisionId: string): PromptVariantConfig | null {
    if (!this.active) return null;
    const variantName = this.assignments.get(decisionId);
    if (!variantName) return null;
    const variant = this.variants.find(v => v.name === variantName);
    return variant?.config ?? null;
  }

  /**
   * Generate a report comparing all variants.
   */
  getReport(): ExperimentReport {
    let totalDecisions = 0;

    const variantReports = this.variants.map(variant => {
      const stat = this.stats.get(variant.name)!;
      totalDecisions += stat.assignments;

      const total = stat.outcomes.length || 1;
      const durations = stat.outcomes.filter(o => o.durationMs).map(o => o.durationMs!);
      const tokens = stat.outcomes.filter(o => o.tokensUsed).map(o => o.tokensUsed!);

      const toolCount = stat.outcomes.filter(o => o.actionType !== 'dialogue' && o.actionType !== 'idle').length;
      const idleCount = stat.outcomes.filter(o => o.actionType === 'idle').length;

      const actionDist: Record<string, number> = {};
      for (const [type, count] of stat.actionTypes) {
        actionDist[type] = count;
      }

      return {
        name: variant.name,
        assignments: stat.assignments,
        toolVariety: stat.toolNames.size,
        actionDistribution: actionDist,
        avgDurationMs: durations.length > 0
          ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
          : 0,
        avgTokens: tokens.length > 0
          ? Math.round(tokens.reduce((s, v) => s + v, 0) / tokens.length)
          : 0,
        toolRate: toolCount / total,
        idleRate: idleCount / total,
      };
    });

    return {
      variants: variantReports,
      totalDecisions,
      isActive: this.active,
    };
  }

  /**
   * Reset all experiment data.
   */
  reset(): void {
    this.variants = [];
    this.totalWeight = 0;
    this.stats.clear();
    this.assignments.clear();
    this.active = false;
  }
}
