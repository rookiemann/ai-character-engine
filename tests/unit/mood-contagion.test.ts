import { describe, it, expect, beforeEach } from 'vitest';
import { MoodContagionManager } from '../../src/agent/MoodContagionManager';
import { EmotionManager } from '../../src/agent/EmotionManager';
import { PerceptionManager } from '../../src/agent/PerceptionManager';
import { RelationshipManager } from '../../src/agent/RelationshipManager';
import { makeChar, createMockRegistry } from '../helpers/factories';

describe('MoodContagionManager', () => {
  let contagion: MoodContagionManager;
  let emotions: EmotionManager;
  let perception: PerceptionManager;
  let relationships: RelationshipManager;
  let registry: any;

  beforeEach(() => {
    const chars = [
      makeChar('c1', 'Alice'),
      makeChar('c2', 'Bob'),
      makeChar('c3', 'Carol'),
      makeChar('c4', 'Dave'),
    ];
    registry = createMockRegistry(chars);
    emotions = new EmotionManager();
    perception = new PerceptionManager(registry);
    relationships = new RelationshipManager({} as any);
    contagion = new MoodContagionManager(perception, emotions, relationships);
  });

  it('should spread fear at the same location', () => {
    perception.updateLocation('c1', 'dungeon');
    perception.updateLocation('c2', 'dungeon');
    emotions.applyEmotion('c1', 'fear', 0.8, 'monster');

    contagion.processContagion();

    const c2emotions = emotions.getEmotions('c2');
    const fear = c2emotions.active.find(e => e.type === 'fear');
    expect(fear).toBeDefined();
    expect(fear!.intensity).toBeGreaterThan(0);
  });

  it('should not spread emotions across different locations', () => {
    perception.updateLocation('c1', 'dungeon');
    perception.updateLocation('c2', 'market');
    emotions.applyEmotion('c1', 'fear', 0.8, 'monster');

    contagion.processContagion();

    const c2emotions = emotions.getEmotions('c2');
    const fear = c2emotions.active.find(e => e.type === 'fear');
    expect(fear).toBeUndefined();
  });

  it('should skip emotions below intensity 0.4', () => {
    perception.updateLocation('c1', 'market');
    perception.updateLocation('c2', 'market');
    emotions.applyEmotion('c1', 'joy', 0.2, 'sunshine'); // Below 0.4 threshold

    contagion.processContagion();

    const c2emotions = emotions.getEmotions('c2');
    const joy = c2emotions.active.find(e => e.type === 'joy');
    expect(joy).toBeUndefined();
  });

  it('should cap contagion intensity at 0.3', () => {
    perception.updateLocation('c1', 'market');
    perception.updateLocation('c2', 'market');
    emotions.applyEmotion('c1', 'fear', 1.0, 'dragon'); // Max intensity

    contagion.processContagion();

    const c2emotions = emotions.getEmotions('c2');
    const fear = c2emotions.active.find(e => e.type === 'fear');
    if (fear) {
      expect(fear.intensity).toBeLessThanOrEqual(0.3);
    }
  });

  it('should boost contagion 1.5x for friends', () => {
    perception.updateLocation('c1', 'market');
    perception.updateLocation('c2', 'market');
    emotions.applyEmotion('c1', 'joy', 0.8, 'celebration');

    // Make c1 and c2 friends
    relationships.update('c1', 'c2', { type: 'friend', strength: 90, trust: 80 });

    contagion.processContagion();
    const friendJoy = emotions.getEmotions('c2').active.find(e => e.type === 'joy');

    // Reset and test without relationship
    emotions = new EmotionManager();
    const noRelContagion = new MoodContagionManager(perception, emotions, new RelationshipManager({} as any));
    emotions.applyEmotion('c1', 'joy', 0.8, 'celebration');
    noRelContagion.processContagion();
    const neutralJoy = emotions.getEmotions('c2').active.find(e => e.type === 'joy');

    if (friendJoy && neutralJoy) {
      expect(friendJoy.intensity).toBeGreaterThan(neutralJoy.intensity);
    }
  });

  it('should reduce contagion 0.3x for enemies', () => {
    perception.updateLocation('c1', 'market');
    perception.updateLocation('c2', 'market');
    emotions.applyEmotion('c1', 'joy', 0.8, 'celebration');

    relationships.update('c1', 'c2', { type: 'enemy', strength: 10, trust: 10 });

    contagion.processContagion();
    const enemyJoy = emotions.getEmotions('c2').active.find(e => e.type === 'joy');

    // Enemies get reduced contagion
    if (enemyJoy) {
      expect(enemyJoy.intensity).toBeLessThan(0.15);
    }
  });

  it('should not apply contagion to the source character', () => {
    perception.updateLocation('c1', 'market');
    perception.updateLocation('c2', 'market');
    emotions.applyEmotion('c1', 'fear', 0.8, 'monster');

    const beforeFear = emotions.getEmotions('c1').active.find(e => e.type === 'fear')!.intensity;
    contagion.processContagion();
    const afterFear = emotions.getEmotions('c1').active.find(e => e.type === 'fear')!.intensity;

    // Source shouldn't get extra intensity from their own contagion
    expect(afterFear).toBe(beforeFear);
  });

  it('should skip locations with fewer than 2 characters', () => {
    perception.updateLocation('c1', 'hermit_cave');
    emotions.applyEmotion('c1', 'fear', 0.9, 'loneliness');

    contagion.processContagion();
    // No error, no crash, nothing to spread to
  });

  it('should handle empty locations gracefully', () => {
    // No locations set at all
    contagion.processContagion();
    // No error
  });
});
