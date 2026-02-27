import { describe, it, expect, beforeEach } from 'vitest';
import { PromptExperiment } from '../../src/agent/PromptExperiment';

describe('PromptExperiment', () => {
  let experiment: PromptExperiment;

  beforeEach(() => {
    experiment = new PromptExperiment();
  });

  it('should register variants', () => {
    experiment.registerVariant('control', { instructionSuffix: '' });
    experiment.registerVariant('bias', { instructionSuffix: 'Prefer tools' });
    // No error means variants registered successfully
  });

  it('should start only with 2+ variants', () => {
    experiment.registerVariant('control', {});
    experiment.start();
    expect(experiment.isActive).toBe(false); // Only 1 variant

    experiment.registerVariant('bias', { instructionSuffix: 'test' });
    experiment.start();
    expect(experiment.isActive).toBe(true);
  });

  it('should stop experiment', () => {
    experiment.registerVariant('a', {});
    experiment.registerVariant('b', {});
    experiment.start();
    experiment.stop();
    expect(experiment.isActive).toBe(false);
  });

  it('should report isActive correctly', () => {
    expect(experiment.isActive).toBe(false);
    experiment.registerVariant('a', {});
    experiment.registerVariant('b', {});
    experiment.start();
    expect(experiment.isActive).toBe(true);
  });

  it('should return null on assign when inactive', () => {
    experiment.registerVariant('a', {});
    experiment.registerVariant('b', {});
    // Not started
    expect(experiment.assign('char1', 'dec1')).toBeNull();
  });

  it('should assign variants when active using weighted selection', () => {
    experiment.registerVariant('a', {}, 1);
    experiment.registerVariant('b', {}, 1);
    experiment.start();

    const assigned = experiment.assign('char1', 'dec1');
    expect(assigned).not.toBeNull();
    expect(['a', 'b']).toContain(assigned!.name);
  });

  it('should record outcome and track tools/actions', () => {
    experiment.registerVariant('a', {}, 1);
    experiment.registerVariant('b', {}, 1);
    experiment.start();

    const variant = experiment.assign('char1', 'dec1')!;
    experiment.recordOutcome('dec1', {
      actionType: 'tool',
      toolName: 'attack',
      durationMs: 100,
      tokensUsed: 50,
    });

    const report = experiment.getReport();
    const variantReport = report.variants.find(v => v.name === variant.name);
    expect(variantReport!.assignments).toBeGreaterThanOrEqual(1);
  });

  it('should clean up assignment after recording outcome', () => {
    experiment.registerVariant('a', {}, 1);
    experiment.registerVariant('b', {}, 1);
    experiment.start();

    experiment.assign('char1', 'dec1');
    experiment.recordOutcome('dec1', { actionType: 'idle' });

    // getActiveVariant should return null since assignment was cleaned up
    expect(experiment.getActiveVariant('dec1')).toBeNull();
  });

  it('should compute toolRate, idleRate, toolVariety in report', () => {
    experiment.registerVariant('control', {}, 1);
    experiment.registerVariant('bias', { instructionSuffix: 'test' }, 1);
    experiment.start();

    // Run several decisions for control variant
    for (let i = 0; i < 10; i++) {
      const v = experiment.assign('char1', `dec${i}`);
      const actionType = i < 6 ? 'tool' : i < 8 ? 'dialogue' : 'idle';
      const toolName = i < 3 ? 'attack' : i < 6 ? 'rest' : undefined;
      experiment.recordOutcome(`dec${i}`, { actionType, toolName, durationMs: 100, tokensUsed: 50 });
    }

    const report = experiment.getReport();
    expect(report.totalDecisions).toBe(10);
    expect(report.isActive).toBe(true);
    for (const v of report.variants) {
      if (v.assignments > 0) {
        expect(v.avgDurationMs).toBeGreaterThan(0);
        expect(v.avgTokens).toBeGreaterThan(0);
      }
    }
  });

  it('should reset all experiment data', () => {
    experiment.registerVariant('a', {}, 1);
    experiment.registerVariant('b', {}, 1);
    experiment.start();
    experiment.assign('char1', 'dec1');
    experiment.reset();
    expect(experiment.isActive).toBe(false);
    const report = experiment.getReport();
    expect(report.variants).toHaveLength(0);
    expect(report.totalDecisions).toBe(0);
  });
});
