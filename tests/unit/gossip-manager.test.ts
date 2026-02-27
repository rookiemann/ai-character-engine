import { describe, it, expect, beforeEach } from 'vitest';
import { GossipManager } from '../../src/agent/GossipManager';
import { makeChar, createMockRegistry, makeGameEvent } from '../helpers/factories';
import { PerceptionManager } from '../../src/agent/PerceptionManager';

describe('GossipManager', () => {
  let gossip: GossipManager;
  let registry: any;
  let perception: PerceptionManager;

  beforeEach(() => {
    const chars = [makeChar('c1', 'Alice'), makeChar('c2', 'Bob'), makeChar('c3', 'Carol')];
    registry = createMockRegistry(chars);
    perception = new PerceptionManager(registry);
    gossip = new GossipManager(perception, registry);
  });

  // --- createFromEvent ---

  it('should create gossip from high importance event', () => {
    const event = makeGameEvent('theft', { importance: 7, target: 'merchant', data: { detail: 'Stole gold' } });
    const item = gossip.createFromEvent(event, 'c1');
    expect(item).not.toBeNull();
    expect(item!.importance).toBe(7);
    expect(item!.credibility).toBe(1.0);
    expect(item!.source).toBe('Alice');
  });

  it('should return null for low importance event', () => {
    const event = makeGameEvent('whisper', { importance: 2 });
    const item = gossip.createFromEvent(event, 'c1');
    expect(item).toBeNull();
  });

  it('should give origin character knowledge of the gossip', () => {
    const event = makeGameEvent('theft', { importance: 7, target: 'merchant' });
    gossip.createFromEvent(event, 'c1');
    const known = gossip.getKnownGossip('c1');
    expect(known.length).toBe(1);
  });

  it('should enforce global cap of 200 gossip items', () => {
    for (let i = 0; i < 205; i++) {
      const event = makeGameEvent('event', { importance: 6, target: 'x' });
      gossip.createFromEvent(event, 'c1');
    }
    // Internal map should not exceed 200
    const known = gossip.getKnownGossip('c1');
    expect(known.length).toBeLessThanOrEqual(200);
  });

  // --- spreadBetween ---

  it('should spread gossip bidirectionally', () => {
    const event = makeGameEvent('theft', { importance: 7, target: 'merchant' });
    gossip.createFromEvent(event, 'c1');
    gossip.spreadBetween('c1', 'c2');
    expect(gossip.getKnownGossip('c2').length).toBe(1);
  });

  it('should degrade credibility by 0.8 per hop', () => {
    const event = makeGameEvent('theft', { importance: 7, target: 'merchant' });
    gossip.createFromEvent(event, 'c1');
    gossip.spreadBetween('c1', 'c2');
    const c2gossip = gossip.getKnownGossip('c2');
    expect(c2gossip[0].credibility).toBeCloseTo(0.8);
  });

  it('should increment spreadCount on spread', () => {
    const event = makeGameEvent('theft', { importance: 7, target: 'merchant' });
    gossip.createFromEvent(event, 'c1');
    gossip.spreadBetween('c1', 'c2');
    const c2gossip = gossip.getKnownGossip('c2');
    expect(c2gossip[0].spreadCount).toBe(1);
  });

  it('should skip gossip the recipient already knows', () => {
    const event = makeGameEvent('theft', { importance: 7, target: 'merchant' });
    gossip.createFromEvent(event, 'c1');
    gossip.spreadBetween('c1', 'c2');
    gossip.spreadBetween('c1', 'c2'); // Second spread - already knows
    expect(gossip.getKnownGossip('c2').length).toBe(1);
  });

  // --- expireOldGossip ---

  it('should expire gossip past TTL', () => {
    const mgr = new GossipManager(perception, registry, { ttlMs: -1 });
    const event = makeGameEvent('theft', { importance: 7, target: 'merchant' });
    mgr.createFromEvent(event, 'c1');
    mgr.expireOldGossip();
    expect(mgr.getKnownGossip('c1').length).toBe(0);
  });

  // --- getGossipPrompt ---

  it('should return top 2 gossip with credibility qualifier', () => {
    const event1 = makeGameEvent('theft', { importance: 8, target: 'merchant', data: { detail: 'Stole gold' } });
    const event2 = makeGameEvent('fight', { importance: 6, target: 'guard', data: { detail: 'Fought guard' } });
    gossip.createFromEvent(event1, 'c1');
    gossip.createFromEvent(event2, 'c1');
    const prompt = gossip.getGossipPrompt('c1');
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("You've heard:");
    expect(prompt).toContain('reliable rumor');
  });

  it('should return null if character knows no gossip', () => {
    expect(gossip.getGossipPrompt('c2')).toBeNull();
  });

  // --- addKnowledge cap ---

  it('should enforce per-character cap of 20 (FIFO)', () => {
    // Create 25 gossip items
    for (let i = 0; i < 25; i++) {
      const event = makeGameEvent(`evt${i}`, { importance: 6, target: 'x' });
      gossip.createFromEvent(event, 'c1');
    }
    expect(gossip.getKnownGossip('c1').length).toBeLessThanOrEqual(20);
  });

  // --- clearCharacter ---

  it('should clear gossip knowledge for a character', () => {
    const event = makeGameEvent('theft', { importance: 7, target: 'merchant' });
    gossip.createFromEvent(event, 'c1');
    expect(gossip.getKnownGossip('c1').length).toBe(1);
    gossip.clearCharacter('c1');
    expect(gossip.getKnownGossip('c1').length).toBe(0);
  });
});
