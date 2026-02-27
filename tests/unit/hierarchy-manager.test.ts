import { describe, it, expect, beforeEach } from 'vitest';
import { HierarchyManager } from '../../src/agent/HierarchyManager';
import { RelationshipManager } from '../../src/agent/RelationshipManager';
import { ReputationManager } from '../../src/agent/ReputationManager';
import { PerceptionManager } from '../../src/agent/PerceptionManager';
import { makeChar, createMockRegistry, createMockEmitter } from '../helpers/factories';
import type { HierarchyDefinition } from '../../src/core/types';

const guildDef: HierarchyDefinition = {
  factionId: 'guild',
  factionName: 'Adventurers Guild',
  ranks: [
    { level: 0, name: 'Guildmaster', maxMembers: 1 },
    { level: 1, name: 'Officer' },
    { level: 2, name: 'Member' },
  ],
};

describe('HierarchyManager', () => {
  let hierarchy: HierarchyManager;
  let registry: any;
  let emitter: any;

  beforeEach(() => {
    const chars = [
      makeChar('c1', 'Alice'),
      makeChar('c2', 'Bob'),
      makeChar('c3', 'Carol'),
      makeChar('c4', 'Dave'),
    ];
    registry = createMockRegistry(chars);
    emitter = createMockEmitter();
    const perception = new PerceptionManager(registry);
    const relationships = new RelationshipManager({} as any);
    const reputation = new ReputationManager(perception, registry);
    hierarchy = new HierarchyManager(registry, relationships, reputation, emitter);
  });

  // --- defineFaction ---

  it('should define a faction with sorted ranks', () => {
    hierarchy.defineFaction(guildDef);
    const faction = hierarchy.getFaction('guild');
    expect(faction).toBeDefined();
    expect(faction!.factionName).toBe('Adventurers Guild');
    expect(faction!.ranks[0].level).toBe(0);
    expect(faction!.ranks[2].level).toBe(2);
  });

  // --- setRank ---

  it('should assign a rank to a character', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    const mem = hierarchy.getMembership('c1', 'guild');
    expect(mem).not.toBeNull();
    expect(mem!.rankLevel).toBe(0);
  });

  it('should update an existing rank', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 2);
    hierarchy.setRank('c1', 'guild', 1);
    const mem = hierarchy.getMembership('c1', 'guild');
    expect(mem!.rankLevel).toBe(1);
  });

  it('should enforce maxMembers constraint', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0); // Guildmaster (max 1)
    hierarchy.setRank('c2', 'guild', 0); // Should fail silently
    expect(hierarchy.getMembership('c2', 'guild')).toBeNull();
  });

  it('should emit hierarchy:rankChanged event', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 2);
    const events = emitter.emitted.filter((e: any) => e.event === 'hierarchy:rankChanged');
    expect(events.length).toBe(1);
  });

  it('should ignore unknown faction', () => {
    hierarchy.setRank('c1', 'unknown', 0);
    expect(hierarchy.getMembership('c1', 'unknown')).toBeNull();
  });

  // --- Chain of command ---

  it('should return superiors (lower rank level)', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    hierarchy.setRank('c2', 'guild', 1);
    hierarchy.setRank('c3', 'guild', 2);

    const superiors = hierarchy.getSuperiors('c3', 'guild');
    expect(superiors.length).toBe(2); // c1 (level 0) and c2 (level 1)
  });

  it('should return direct superiors (rank - 1)', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    hierarchy.setRank('c2', 'guild', 1);
    hierarchy.setRank('c3', 'guild', 2);

    const direct = hierarchy.getDirectSuperiors('c3', 'guild');
    expect(direct.length).toBe(1);
    expect(direct[0].characterId).toBe('c2');
  });

  it('should return subordinates (higher rank level)', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    hierarchy.setRank('c2', 'guild', 1);
    hierarchy.setRank('c3', 'guild', 2);

    const subs = hierarchy.getSubordinates('c1', 'guild');
    expect(subs.length).toBe(2);
  });

  // --- issueOrder ---

  it('should issue order from superior to subordinate', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    hierarchy.setRank('c2', 'guild', 2);

    const order = hierarchy.issueOrder('c1', 'c2', 'guild', 'Guard the gate', 'combat');
    expect(order).not.toBeNull();
    expect(order!.instruction).toBe('Guard the gate');
    expect(order!.active).toBe(true);
  });

  it('should reject order from equal or lower rank', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 2);
    hierarchy.setRank('c2', 'guild', 1);

    const order = hierarchy.issueOrder('c1', 'c2', 'guild', 'Do something', 'general');
    expect(order).toBeNull();
  });

  it('should reject order when character not in faction', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);

    const order = hierarchy.issueOrder('c1', 'c2', 'guild', 'Join us', 'recruitment');
    expect(order).toBeNull();
  });

  // --- promote/demote ---

  it('should promote a character one rank up', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c2', 'guild', 2);
    const promoted = hierarchy.promote('c2', 'guild');
    expect(promoted).toBe(true);
    expect(hierarchy.getMembership('c2', 'guild')!.rankLevel).toBe(1);
  });

  it('should return false when already at top rank', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    expect(hierarchy.promote('c1', 'guild')).toBe(false);
  });

  it('should demote a character one rank down', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c2', 'guild', 1);
    const demoted = hierarchy.demote('c2', 'guild');
    expect(demoted).toBe(true);
    expect(hierarchy.getMembership('c2', 'guild')!.rankLevel).toBe(2);
  });

  it('should return false when already at bottom rank', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c2', 'guild', 2);
    expect(hierarchy.demote('c2', 'guild')).toBe(false);
  });

  // --- handleSuccession ---

  it('should use plugin choice for succession', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    hierarchy.setRank('c2', 'guild', 1);
    hierarchy.setRank('c3', 'guild', 1);

    const plugin = {
      onSuccession: () => 'c3',
    } as any;

    const promotedId = hierarchy.handleSuccession('c1', 'guild', plugin);
    expect(promotedId).toBe('c3');
  });

  it('should fall back to score-based succession without plugin', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    hierarchy.setRank('c2', 'guild', 1);

    const promotedId = hierarchy.handleSuccession('c1', 'guild', null);
    expect(promotedId).toBe('c2');
  });

  it('should return null when no candidates available', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    // No one at level 1 to promote

    const promotedId = hierarchy.handleSuccession('c1', 'guild', null);
    expect(promotedId).toBeNull();
  });

  // --- getHierarchyPrompt ---

  it('should return prompt with rank and faction info', () => {
    hierarchy.defineFaction(guildDef);
    hierarchy.setRank('c1', 'guild', 0);
    hierarchy.setRank('c2', 'guild', 1);

    const prompt = hierarchy.getHierarchyPrompt('c1');
    expect(prompt).not.toBeNull();
    expect(prompt).toContain('Guildmaster');
    expect(prompt).toContain('Adventurers Guild');
  });
});
