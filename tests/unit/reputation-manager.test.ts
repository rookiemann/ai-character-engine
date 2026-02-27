import { describe, it, expect, beforeEach } from 'vitest';
import { ReputationManager } from '../../src/agent/ReputationManager';
import { PerceptionManager } from '../../src/agent/PerceptionManager';
import { makeChar, createMockRegistry } from '../helpers/factories';

describe('ReputationManager', () => {
  let reputation: ReputationManager;
  let perception: PerceptionManager;
  let registry: any;

  beforeEach(() => {
    const chars = [makeChar('c1', 'Alice'), makeChar('c2', 'Bob'), makeChar('c3', 'Carol')];
    registry = createMockRegistry(chars);
    perception = new PerceptionManager(registry);
    reputation = new ReputationManager(perception, registry);
  });

  // --- Auto-init ---

  it('should auto-initialize reputation to 0', () => {
    const rep = reputation.getReputation('c1');
    expect(rep.characterId).toBe('c1');
    expect(rep.scores.general).toBe(0);
  });

  // --- changeReputation ---

  it('should apply positive delta', () => {
    reputation.changeReputation('c1', 'general', 5, 'helped someone', []);
    expect(reputation.getReputation('c1').scores.general).toBe(5);
  });

  it('should clamp to +100 max', () => {
    reputation.changeReputation('c1', 'general', 150, 'legendary deed', []);
    expect(reputation.getReputation('c1').scores.general).toBe(100);
  });

  it('should clamp to -100 min', () => {
    reputation.changeReputation('c1', 'general', -150, 'terrible crime', []);
    expect(reputation.getReputation('c1').scores.general).toBe(-100);
  });

  it('should accept witnesses', () => {
    reputation.changeReputation('c1', 'general', 3, 'public act', ['c2', 'c3']);
    const events = reputation.getRecentEvents('c1');
    expect(events.length).toBe(1);
    expect(events[0].witnessIds).toContain('c2');
  });

  it('should create gossip for delta >= 3 when gossipManager provided', () => {
    // Create a simple mock gossip manager
    const gossipMgr = {
      createFromEvent: vi.fn().mockReturnValue({ id: 'g1' }),
      addKnowledge: vi.fn(),
    } as any;
    reputation.changeReputation('c1', 'general', 5, 'big event', ['c2'], gossipMgr);
    expect(gossipMgr.createFromEvent).toHaveBeenCalled();
  });

  // --- processToolExecution ---

  it('should apply +1 for talk_to with witnesses', () => {
    perception.updateLocation('c1', 'market');
    perception.updateLocation('c2', 'market');
    reputation.processToolExecution('c1', 'talk_to', true);
    expect(reputation.getReputation('c1').scores.general).toBe(1);
  });

  it('should apply -3 for fight with witnesses', () => {
    perception.updateLocation('c1', 'arena');
    perception.updateLocation('c2', 'arena');
    reputation.processToolExecution('c1', 'fight', true);
    expect(reputation.getReputation('c1').scores.general).toBe(-3);
  });

  it('should not change reputation without witnesses', () => {
    perception.updateLocation('c1', 'cave');
    // c2 and c3 are elsewhere
    reputation.processToolExecution('c1', 'talk_to', true);
    expect(reputation.getReputation('c1').scores.general).toBe(0);
  });

  it('should not change reputation for unmapped tools', () => {
    perception.updateLocation('c1', 'market');
    perception.updateLocation('c2', 'market');
    reputation.processToolExecution('c1', 'unknown_tool', true);
    expect(reputation.getReputation('c1').scores.general).toBe(0);
  });

  // --- decayAll ---

  it('should decay positive reputation toward 0', () => {
    reputation.changeReputation('c1', 'general', 10, 'good', []);
    reputation.decayAll();
    expect(reputation.getReputation('c1').scores.general).toBeLessThan(10);
    expect(reputation.getReputation('c1').scores.general).toBeGreaterThanOrEqual(0);
  });

  it('should decay negative reputation toward 0', () => {
    reputation.changeReputation('c1', 'general', -10, 'bad', []);
    reputation.decayAll();
    expect(reputation.getReputation('c1').scores.general).toBeGreaterThan(-10);
    expect(reputation.getReputation('c1').scores.general).toBeLessThanOrEqual(0);
  });

  // --- getReputationPrompt ---

  it('should include own reputation when significant', () => {
    reputation.changeReputation('c1', 'general', 25, 'good', []);
    perception.updateLocation('c1', 'market');
    const prompt = reputation.getReputationPrompt('c1');
    expect(prompt).not.toBeNull();
    expect(prompt).toContain('Your reputation');
    expect(prompt).toContain('respected');
  });

  it('should include nearby characters reputation', () => {
    reputation.changeReputation('c2', 'general', -60, 'terrible', []);
    perception.updateLocation('c1', 'market');
    perception.updateLocation('c2', 'market');
    const prompt = reputation.getReputationPrompt('c1');
    expect(prompt).toContain('notorious');
  });

  // --- clearCharacter ---

  it('should clear reputation data for a character', () => {
    reputation.changeReputation('c1', 'general', 50, 'hero', []);
    reputation.clearCharacter('c1');
    // After clearing, should auto-init back to 0
    expect(reputation.getReputation('c1').scores.general).toBe(0);
  });
});

// vi import for mock
import { vi } from 'vitest';
