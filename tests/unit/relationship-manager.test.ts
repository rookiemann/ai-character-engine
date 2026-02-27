import { describe, it, expect, beforeEach } from 'vitest';
import { RelationshipManager } from '../../src/agent/RelationshipManager';

describe('RelationshipManager', () => {
  let relationships: RelationshipManager;

  beforeEach(() => {
    relationships = new RelationshipManager({} as any);
  });

  // --- Auto-create ---

  it('should auto-create neutral relationship (50/50)', () => {
    const rel = relationships.get('c1', 'c2');
    expect(rel.type).toBe('neutral');
    expect(rel.strength).toBe(50);
    expect(rel.trust).toBe(50);
  });

  it('should cache relationship on second access', () => {
    const rel1 = relationships.get('c1', 'c2');
    const rel2 = relationships.get('c1', 'c2');
    expect(rel1).toBe(rel2);
  });

  // --- update ---

  it('should update type, strength, and trust', () => {
    const rel = relationships.update('c1', 'c2', { type: 'friend', strength: 80, trust: 70 });
    expect(rel.type).toBe('friend');
    expect(rel.strength).toBe(80);
    expect(rel.trust).toBe(70);
  });

  it('should clamp strength to 0-100', () => {
    const rel = relationships.update('c1', 'c2', { strength: 150 });
    expect(rel.strength).toBe(100);
    const rel2 = relationships.update('c1', 'c2', { strength: -50 });
    expect(rel2.strength).toBe(0);
  });

  it('should clamp trust to 0-100', () => {
    const rel = relationships.update('c1', 'c2', { trust: 200 });
    expect(rel.trust).toBe(100);
  });

  it('should auto-infer type from strength when type not specified', () => {
    relationships.update('c1', 'c2', { strength: 85, trust: 75 });
    const rel = relationships.get('c1', 'c2');
    expect(rel.type).toBe('friend');
  });

  // --- recordInteraction ---

  it('should increase strength/trust on positive interaction', () => {
    relationships.recordInteraction('c1', 'c2', 'positive');
    const rel = relationships.get('c1', 'c2');
    expect(rel.strength).toBeGreaterThan(50);
    expect(rel.trust).toBeGreaterThan(50);
  });

  it('should decrease strength/trust on negative interaction', () => {
    relationships.recordInteraction('c1', 'c2', 'negative');
    const rel = relationships.get('c1', 'c2');
    expect(rel.strength).toBeLessThan(50);
    expect(rel.trust).toBeLessThan(50);
  });

  it('should slightly increase strength on neutral interaction', () => {
    relationships.recordInteraction('c1', 'c2', 'neutral');
    const rel = relationships.get('c1', 'c2');
    expect(rel.strength).toBe(50.5);
  });

  it('should auto-infer type after interaction', () => {
    // Many negative interactions → enemy
    for (let i = 0; i < 10; i++) {
      relationships.recordInteraction('c1', 'c2', 'negative');
    }
    const rel = relationships.get('c1', 'c2');
    expect(['enemy', 'rival']).toContain(rel.type);
  });

  // --- decayAll ---

  it('should not decay deep bonds (strength >= 90)', () => {
    relationships.update('c1', 'c2', { strength: 95, trust: 80 });
    relationships.decayAll();
    expect(relationships.get('c1', 'c2').strength).toBe(95);
  });

  it('should decay new acquaintances faster', () => {
    relationships.update('c1', 'c2', { strength: 55 });
    // No interactions recorded → new acquaintance
    relationships.decayAll();
    const rel = relationships.get('c1', 'c2');
    expect(rel.strength).toBeLessThan(55);
  });

  it('should decay established relationships slower', () => {
    relationships.update('c1', 'c2', { strength: 75, trust: 65 });
    // Record enough interactions to qualify as established
    for (let i = 0; i < 5; i++) {
      relationships.recordInteraction('c1', 'c2', 'positive');
    }
    const before = relationships.get('c1', 'c2').strength;
    relationships.decayAll();
    const after = relationships.get('c1', 'c2').strength;
    const decayAmount = before - after;
    expect(decayAmount).toBeLessThanOrEqual(0.05);
  });

  it('should decay toward 50 (neutral)', () => {
    relationships.update('c1', 'c2', { strength: 55 });
    for (let i = 0; i < 100; i++) relationships.decayAll();
    const rel = relationships.get('c1', 'c2');
    expect(rel.strength).toBeCloseTo(50, 0);
  });

  // --- getRelationshipPrompt ---

  it('should return sorted relationships excluding neutral', () => {
    relationships.update('c1', 'c2', { type: 'friend', strength: 80, trust: 70 });
    relationships.update('c1', 'c3', { type: 'rival', strength: 25, trust: 20 });
    const prompt = relationships.getRelationshipPrompt('c1');
    expect(prompt).not.toBeNull();
    expect(prompt).toContain('Relationships:');
    expect(prompt).toContain('friend');
  });

  it('should return null if all relationships are neutral', () => {
    relationships.get('c1', 'c2'); // Creates neutral
    expect(relationships.getRelationshipPrompt('c1')).toBeNull();
  });

  // --- clearCharacter ---

  it('should clear all relationships for a character', () => {
    relationships.update('c1', 'c2', { type: 'friend', strength: 80 });
    relationships.update('c1', 'c3', { type: 'ally', strength: 70 });
    relationships.clearCharacter('c1');
    expect(relationships.getRelationships('c1')).toHaveLength(0);
  });
});
