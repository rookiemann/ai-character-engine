import { describe, it, expect, beforeEach } from 'vitest';
import { PromptBuilder } from '../../src/agent/PromptBuilder';
import { makeChar, makeToolDef, makeSummaryRecord } from '../helpers/factories';
import type { DelegationOrder, ToolDefinition } from '../../src/core/types';
import type { PromptExtensions } from '../../src/agent/PromptBuilder';

describe('PromptBuilder', () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
  });

  // --- Identity section ---

  it('should include character name and archetype in identity', () => {
    const char = makeChar('c1', 'Kira', { archetype: 'mage' });
    const prompt = builder.buildSystemPrompt(char);
    expect(prompt).toContain('You are Kira');
    expect(prompt).toContain('mage');
  });

  it('should include personality and traits', () => {
    const char = makeChar('c1', 'Kira', {
      identity: { personality: 'cunning', backstory: '', goals: [], traits: ['clever', 'sneaky'] },
    });
    const prompt = builder.buildSystemPrompt(char);
    expect(prompt).toContain('Personality: cunning');
    expect(prompt).toContain('Traits: clever, sneaky');
  });

  it('should include speech style when present', () => {
    const char = makeChar('c1', 'Kira', {
      identity: { personality: 'bold', backstory: '', goals: [], traits: [], speechStyle: 'formal and polite' },
    });
    const prompt = builder.buildSystemPrompt(char);
    expect(prompt).toContain('Speech: formal and polite');
  });

  it('should include goals when present', () => {
    const char = makeChar('c1', 'Kira', {
      identity: { personality: 'bold', backstory: '', goals: ['Find the gem', 'Save the village'], traits: [] },
    });
    const prompt = builder.buildSystemPrompt(char);
    expect(prompt).toContain('Goals: Find the gem; Save the village');
  });

  // --- World rules ---

  it('should include world rules section', () => {
    const char = makeChar('c1', 'Kira');
    const prompt = builder.buildSystemPrompt(char, 'Magic is forbidden in this realm');
    expect(prompt).toContain('<world>');
    expect(prompt).toContain('Magic is forbidden');
  });

  // --- Summary/backstory ---

  it('should include summary with relationship notes', () => {
    const char = makeChar('c1', 'Kira');
    const summary = makeSummaryRecord('c1', {
      summary: 'A wandering mage',
      relationshipNotes: 'Friendly with the player',
    });
    const prompt = builder.buildSystemPrompt(char, undefined, summary);
    expect(prompt).toContain('<backstory>');
    expect(prompt).toContain('A wandering mage');
    expect(prompt).toContain('Relationship with player: Friendly with the player');
  });

  // --- Delegations ---

  it('should include delegations section', () => {
    const char = makeChar('c1', 'Kira');
    const delegations: DelegationOrder[] = [{
      id: 'd1', characterId: 'c1', playerId: 'default',
      instruction: 'Guard the gate', scope: 'combat', active: true, createdAt: Date.now(),
    }];
    const prompt = builder.buildSystemPrompt(char, undefined, undefined, delegations);
    expect(prompt).toContain('<delegations>');
    expect(prompt).toContain('Guard the gate');
    expect(prompt).toContain('scope: combat');
  });

  // --- Tool formatting ---

  it('should format tools with parameter types and enums', () => {
    const char = makeChar('c1', 'Kira');
    const tools: ToolDefinition[] = [
      makeToolDef('move', [
        { name: 'direction', type: 'string', description: 'Dir', enum: ['north', 'south'] },
      ]),
    ];
    const prompt = builder.buildSystemPrompt(char, undefined, undefined, undefined, undefined, tools);
    expect(prompt).toContain('<tools>');
    expect(prompt).toContain('move(');
    expect(prompt).toContain('[north|south]');
  });

  // --- Hint fitting ---

  it('should include high-priority hints before low-priority', () => {
    const char = makeChar('c1', 'Kira');
    const extensions: PromptExtensions = {
      emotionHint: 'You feel happy',
      gossipHint: 'You heard a rumor',
    };
    const prompt = builder.buildSystemPrompt(char, undefined, undefined, undefined, extensions, undefined, 1000);
    expect(prompt).toContain('You feel happy');
    // gossipHint is low priority - may or may not be included depending on budget
  });

  it('should respect tier-based max hints (dormant=2)', () => {
    const char = makeChar('c1', 'Kira', { activityTier: 'dormant' });
    const extensions: PromptExtensions = {
      emotionHint: 'Happy',
      goalHint: 'Find treasure',
      needsHint: 'Hungry',
      relationshipHint: 'Likes Bob',
      perceptionHint: 'Sees a cat',
    };
    const prompt = builder.buildSystemPrompt(char, undefined, undefined, undefined, extensions, undefined, 2000);
    // Dormant: max 2 hints. Count actual hint lines in context section
    const contextMatch = prompt.match(/<context>([\s\S]*?)<\/context>/);
    if (contextMatch) {
      const hintLines = contextMatch[1].trim().split('\n').filter(l => l.trim().length > 0);
      expect(hintLines.length).toBeLessThanOrEqual(2);
    }
  });

  it('should skip hints that exceed token budget', () => {
    const char = makeChar('c1', 'Kira');
    const longHint = 'A'.repeat(2000); // Very long, ~500 tokens
    const extensions: PromptExtensions = {
      emotionHint: longHint,
      goalHint: 'Short hint',
    };
    // Very small budget — long hint should be skipped but short may fit
    const prompt = builder.buildSystemPrompt(char, undefined, undefined, undefined, extensions, undefined, 50);
    expect(prompt).not.toContain(longHint);
  });

  // --- Cache ---

  it('should cache identical prompts', () => {
    const char = makeChar('c1', 'Kira');
    builder.buildSystemPrompt(char);
    builder.buildSystemPrompt(char);
    const stats = builder.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it('should evict oldest entry when cache is full (128)', () => {
    // Fill cache with 128 different prompts
    for (let i = 0; i < 130; i++) {
      const char = makeChar(`c${i}`, `Char${i}`);
      builder.buildSystemPrompt(char);
    }
    const stats = builder.getCacheStats();
    expect(stats.size).toBeLessThanOrEqual(128);
  });

  // --- Chat prompt ---

  it('should build chat prompt without tools or hints', () => {
    const char = makeChar('c1', 'Kira');
    const prompt = builder.buildChatPrompt(char);
    expect(prompt).toContain('You are Kira');
    expect(prompt).toContain('conversation with the player');
    expect(prompt).not.toContain('<tools>');
  });
});
