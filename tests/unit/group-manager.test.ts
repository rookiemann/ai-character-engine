import { describe, it, expect, beforeEach } from 'vitest';
import { GroupManager } from '../../src/agent/GroupManager';
import { makeChar, createMockRegistry } from '../helpers/factories';
import type { AgentDecisionResult } from '../../src/core/types';

describe('GroupManager', () => {
  let groups: GroupManager;
  let registry: any;

  beforeEach(() => {
    const chars = [
      makeChar('c1', 'Alice'),
      makeChar('c2', 'Bob'),
      makeChar('c3', 'Carol'),
    ];
    registry = createMockRegistry(chars);
    groups = new GroupManager(registry);
  });

  it('should create a group with leader as first member', () => {
    const group = groups.createGroup('Party', ['c1', 'c2'], 'adventure');
    expect(group.leaderId).toBe('c1');
    expect(group.cohesion).toBe(0.7);
    expect(group.memberIds).toEqual(['c1', 'c2']);
  });

  it('should add a member and reduce cohesion', () => {
    const group = groups.createGroup('Party', ['c1'], 'adventure');
    groups.addMember(group.id, 'c2');
    const updated = groups.get(group.id)!;
    expect(updated.memberIds).toContain('c2');
    expect(updated.cohesion).toBeLessThan(0.7);
  });

  it('should not add duplicate member', () => {
    const group = groups.createGroup('Party', ['c1', 'c2'], 'adventure');
    groups.addMember(group.id, 'c2');
    expect(groups.get(group.id)!.memberIds.filter(id => id === 'c2').length).toBe(1);
  });

  it('should remove member and reassign leader', () => {
    const group = groups.createGroup('Party', ['c1', 'c2', 'c3'], 'adventure');
    groups.removeMember(group.id, 'c1'); // Remove leader
    const updated = groups.get(group.id)!;
    expect(updated.memberIds).not.toContain('c1');
    expect(updated.leaderId).toBe('c2'); // Reassigned
  });

  it('should resolve group decision by voting', () => {
    const group = groups.createGroup('Party', ['c1', 'c2', 'c3'], 'adventure');
    const results: AgentDecisionResult[] = [
      { characterId: 'c1', action: { toolName: 'rest', arguments: {} }, tokensUsed: 10, inferenceTier: 'mid', durationMs: 100 },
      { characterId: 'c2', action: { toolName: 'rest', arguments: {} }, tokensUsed: 10, inferenceTier: 'mid', durationMs: 100 },
      { characterId: 'c3', action: { type: 'idle' }, tokensUsed: 10, inferenceTier: 'mid', durationMs: 100 },
    ];
    const decision = groups.resolveGroupDecision(group.id, results);
    expect(decision).not.toBeNull();
    expect('toolName' in decision!.action).toBe(true);
    expect(decision!.consensus).toBeGreaterThan(0.5);
  });

  it('should give leader tiebreak bonus', () => {
    const group = groups.createGroup('Party', ['c1', 'c2'], 'adventure');
    const results: AgentDecisionResult[] = [
      { characterId: 'c1', action: { toolName: 'rest', arguments: {} }, tokensUsed: 10, inferenceTier: 'mid', durationMs: 100 },
      { characterId: 'c2', action: { type: 'idle' }, tokensUsed: 10, inferenceTier: 'mid', durationMs: 100 },
    ];
    const decision = groups.resolveGroupDecision(group.id, results);
    expect(decision).not.toBeNull();
    // Leader agreed (c1 is leader and voted for rest), so consensus gets +0.1 bonus
    expect(decision!.consensus).toBeGreaterThan(0.5);
  });

  it('should update cohesion based on consensus', () => {
    const group = groups.createGroup('Party', ['c1', 'c2'], 'adventure');
    const initCohesion = group.cohesion;
    const results: AgentDecisionResult[] = [
      { characterId: 'c1', action: { toolName: 'rest', arguments: {} }, tokensUsed: 10, inferenceTier: 'mid', durationMs: 100 },
      { characterId: 'c2', action: { toolName: 'rest', arguments: {} }, tokensUsed: 10, inferenceTier: 'mid', durationMs: 100 },
    ];
    groups.resolveGroupDecision(group.id, results);
    // High consensus should shift cohesion upward
    expect(groups.get(group.id)!.cohesion).not.toBe(initCohesion);
  });

  it('should return null for unknown group', () => {
    expect(groups.resolveGroupDecision('unknown', [])).toBeNull();
  });

  it('should return group prompt with role and member names', () => {
    groups.createGroup('Party', ['c1', 'c2', 'c3'], 'adventure');
    const prompt = groups.getGroupPrompt('c1');
    expect(prompt).not.toBeNull();
    expect(prompt).toContain('Party');
    expect(prompt).toContain('leader');
    expect(prompt).toContain('Bob');
  });

  it('should return null when character in no groups', () => {
    expect(groups.getGroupPrompt('c4')).toBeNull();
  });

  it('should disband a group', () => {
    const group = groups.createGroup('Party', ['c1', 'c2'], 'adventure');
    groups.disband(group.id);
    expect(groups.get(group.id)).toBeUndefined();
  });
});
