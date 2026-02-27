import { describe, it, expect, beforeEach } from 'vitest';

// Expansion subsystems
import { EmotionManager } from '../../src/agent/EmotionManager';
import { GoalPlanner } from '../../src/agent/GoalPlanner';
import { WorldStateManager } from '../../src/agent/WorldStateManager';
import { PlayerModeler } from '../../src/agent/PlayerModeler';
import { PriorityQueue } from '../../src/scheduler/PriorityQueue';


import type {
  AgentDecisionRequest,
  AgentDecisionResult,
  GameEvent,
} from '../../src/core/types';

// ============================================
// Expansion 5: Emotion System
// ============================================

describe('EmotionManager', () => {
  let emotions: EmotionManager;

  beforeEach(() => {
    emotions = new EmotionManager();
  });

  it('should initialize with neutral state', () => {
    const state = emotions.getEmotions('char1');
    expect(state.characterId).toBe('char1');
    expect(state.active).toHaveLength(0);
    expect(state.mood).toBe('trust');
  });

  it('should apply and retrieve emotions', () => {
    emotions.applyEmotion('char1', 'joy', 0.8);
    const state = emotions.getEmotions('char1');
    expect(state.active).toHaveLength(1);
    expect(state.active[0].type).toBe('joy');
    expect(state.active[0].intensity).toBe(0.8);
    expect(state.mood).toBe('joy');
  });

  it('should stack same emotion (not duplicate)', () => {
    emotions.applyEmotion('char1', 'anger', 0.5);
    emotions.applyEmotion('char1', 'anger', 0.4);
    const state = emotions.getEmotions('char1');
    expect(state.active).toHaveLength(1);
    // Stacked: 0.5 + 0.4*0.5 = 0.7
    expect(state.active[0].intensity).toBe(0.7);
  });

  it('should process game events into emotions', () => {
    emotions.processEvent('char1', {
      type: 'combat',
      importance: 7,
      timestamp: Date.now(),
    });
    const state = emotions.getEmotions('char1');
    expect(state.active.length).toBeGreaterThan(0);
    const types = state.active.map(e => e.type);
    expect(types).toContain('fear');
  });

  it('should decay emotions over time', () => {
    emotions.applyEmotion('char1', 'joy', 0.3);
    // Decay several times
    for (let i = 0; i < 10; i++) {
      emotions.decayAll();
    }
    const state = emotions.getEmotions('char1');
    // Should have decayed significantly or been removed
    if (state.active.length > 0) {
      expect(state.active[0].intensity).toBeLessThan(0.3);
    }
  });

  it('should generate emotion prompt', () => {
    emotions.applyEmotion('char1', 'anger', 0.8);
    emotions.applyEmotion('char1', 'sadness', 0.4);
    const prompt = emotions.getEmotionPrompt('char1');
    expect(prompt).toContain('anger');
    expect(prompt).toContain('Current emotions');
  });

  it('should return null prompt when no emotions', () => {
    const prompt = emotions.getEmotionPrompt('char1');
    expect(prompt).toBeNull();
  });
});

// ============================================
// Expansion 7: Goal Planning
// ============================================

describe('GoalPlanner', () => {
  let planner: GoalPlanner;

  beforeEach(() => {
    planner = new GoalPlanner();
  });

  it('should add goals', () => {
    const goal = planner.addGoal('char1', 'Find the treasure', 8, [
      { description: 'Go to the cave', completed: false },
      { description: 'Solve the puzzle', completed: false },
    ]);
    expect(goal.id).toBeDefined();
    expect(goal.characterId).toBe('char1');
    expect(goal.priority).toBe(8);
    expect(goal.steps).toHaveLength(2);
  });

  it('should get active goals sorted by priority', () => {
    planner.addGoal('char1', 'Low priority', 2);
    planner.addGoal('char1', 'High priority', 9);
    planner.addGoal('char1', 'Medium priority', 5);

    const active = planner.getActiveGoals('char1');
    expect(active).toHaveLength(3);
    expect(active[0].priority).toBe(9);
    expect(active[2].priority).toBe(2);
  });

  it('should complete steps and auto-complete goal', () => {
    const goal = planner.addGoal('char1', 'Two steps', 5, [
      { description: 'Step 1', completed: false },
      { description: 'Step 2', completed: false },
    ]);
    planner.activateGoal(goal.id);

    planner.completeStep(goal.id, 0);
    expect(goal.status).toBe('active'); // Not done yet

    planner.completeStep(goal.id, 1);
    expect(goal.status).toBe('completed');
  });

  it('should get current objective', () => {
    const goal = planner.addGoal('char1', 'Multi-step', 8, [
      { description: 'Step 1', completed: true },
      { description: 'Step 2', completed: false, toolName: 'move' },
      { description: 'Step 3', completed: false },
    ]);
    planner.activateGoal(goal.id);

    const obj = planner.getCurrentObjective('char1');
    expect(obj).not.toBeNull();
    expect(obj!.step.description).toBe('Step 2');
    expect(obj!.step.toolName).toBe('move');
    expect(obj!.stepIndex).toBe(1);
  });

  it('should generate goal prompt', () => {
    const goal = planner.addGoal('char1', 'Find treasure', 8, [
      { description: 'Go to cave', completed: true },
      { description: 'Solve puzzle', completed: false },
    ]);
    planner.activateGoal(goal.id);

    const prompt = planner.getGoalPrompt('char1');
    expect(prompt).toContain('Find treasure');
    expect(prompt).toContain('1/2 steps done');
  });

  it('should prune old completed goals', () => {
    const goal = planner.addGoal('char1', 'Old goal', 5);
    planner.updateStatus(goal.id, 'completed');
    // Force old timestamp
    goal.completedAt = Date.now() - 48 * 60 * 60 * 1000;

    planner.prune(24 * 60 * 60 * 1000);
    expect(planner.getAllGoals('char1')).toHaveLength(0);
  });
});

// ============================================
// Expansion 8: World State Manager
// ============================================

describe('WorldStateManager', () => {
  let world: WorldStateManager;

  beforeEach(() => {
    world = new WorldStateManager();
  });

  it('should set and get facts', () => {
    world.set('weather', 'rainy', 'global', 'system');
    expect(world.getValue('weather')).toBe('rainy');
  });

  it('should get facts by category', () => {
    world.set('weather', 'rainy', 'global', 'system');
    world.set('time', 'night', 'global', 'system');
    world.set('shop_open', true, 'location', 'system');

    const global = world.getByCategory('global');
    expect(global).toHaveLength(2);
  });

  it('should query by pattern', () => {
    world.set('tavern_door', 'open', 'location', 'system');
    world.set('tavern_fire', 'lit', 'location', 'system');
    world.set('market_stall', 'closed', 'location', 'system');

    const results = world.query('tavern');
    expect(results).toHaveLength(2);
  });

  it('should remove facts', () => {
    world.set('temp', 'value', 'global', 'system');
    expect(world.remove('temp')).toBe(true);
    expect(world.get('temp')).toBeUndefined();
  });

  it('should generate world prompt', () => {
    world.set('weather', 'stormy', 'global', 'system');
    world.set('time', 'midnight', 'global', 'system');

    const prompt = world.getWorldPrompt();
    expect(prompt).toContain('weather');
    expect(prompt).toContain('World state');
  });

  it('should serialize and deserialize', () => {
    world.set('a', 1, 'cat1', 'src1');
    world.set('b', 'two', 'cat2', 'src2');

    const all = world.getAll();
    const newWorld = new WorldStateManager();
    newWorld.loadAll(all);

    expect(newWorld.getValue('a')).toBe(1);
    expect(newWorld.getValue('b')).toBe('two');
  });
});

// ============================================
// Expansion 9: Player Modeling
// ============================================

describe('PlayerModeler', () => {
  let modeler: PlayerModeler;

  beforeEach(() => {
    modeler = new PlayerModeler();
  });

  it('should create profile on first access', () => {
    const profile = modeler.getProfile('player1');
    expect(profile.playerId).toBe('player1');
    expect(profile.totalInteractions).toBe(0);
  });

  it('should record interactions and update preferences', () => {
    modeler.recordInteraction('player1', 'combat');
    modeler.recordInteraction('player1', 'combat');
    modeler.recordInteraction('player1', 'social');

    const profile = modeler.getProfile('player1');
    expect(profile.totalInteractions).toBe(3);
    // Combat should be 2/3 ≈ 0.67
    expect(profile.preferences['combat']).toBeGreaterThan(0.5);
  });

  it('should get top preferences', () => {
    for (let i = 0; i < 5; i++) modeler.recordInteraction('p1', 'combat');
    for (let i = 0; i < 3; i++) modeler.recordInteraction('p1', 'social');
    modeler.recordInteraction('p1', 'trade');

    const top = modeler.getTopPreferences('p1', 2);
    expect(top).toHaveLength(2);
    expect(top[0].type).toBe('combat');
  });

  it('should generate player prompt after enough data', () => {
    // Less than 5 interactions → null
    for (let i = 0; i < 3; i++) modeler.recordInteraction('p1', 'combat');
    expect(modeler.getPlayerPrompt('p1')).toBeNull();

    // 5+ interactions → prompt
    for (let i = 0; i < 3; i++) modeler.recordInteraction('p1', 'combat');
    const prompt = modeler.getPlayerPrompt('p1');
    expect(prompt).toContain('combat');
  });

  it('should check type preference', () => {
    for (let i = 0; i < 8; i++) modeler.recordInteraction('p1', 'combat');
    for (let i = 0; i < 2; i++) modeler.recordInteraction('p1', 'social');

    expect(modeler.prefersType('p1', 'combat')).toBe(true);
    expect(modeler.prefersType('p1', 'social')).toBe(false);
  });
});

// ============================================
// Expansion 12: Priority Queue
// ============================================

describe('PriorityQueue', () => {
  let queue: PriorityQueue;

  const makeRequest = (id: string, energy: number = 0.5, importance?: number): AgentDecisionRequest => ({
    characterId: id,
    playerId: 'default',
    gameState: { worldTime: 0 },
    proprioception: {},
    availableTools: [],
    energyLevel: energy,
    triggerEvent: importance ? {
      type: 'test',
      importance,
      timestamp: Date.now(),
    } : undefined,
  });

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('should enqueue and dequeue', () => {
    queue.enqueue(makeRequest('a'));
    queue.enqueue(makeRequest('b'));
    expect(queue.size).toBe(2);

    const batch = queue.dequeueBatch(1);
    expect(batch).toHaveLength(1);
    expect(queue.size).toBe(1);
  });

  it('should deduplicate by characterId', () => {
    queue.enqueue(makeRequest('a'));
    queue.enqueue(makeRequest('a'));
    expect(queue.size).toBe(1);
  });

  it('should prioritize event-triggered requests', () => {
    queue.enqueue(makeRequest('low', 0.5));
    queue.enqueue(makeRequest('high', 0.5, 8));

    const batch = queue.dequeueBatch(2);
    expect(batch[0].characterId).toBe('high');
  });

  it('should prioritize high-energy agents', () => {
    queue.enqueue(makeRequest('low', 0.2));
    queue.enqueue(makeRequest('high', 0.9));

    const batch = queue.dequeueBatch(2);
    expect(batch[0].characterId).toBe('high');
  });

  it('should clear the queue', () => {
    queue.enqueue(makeRequest('a'));
    queue.enqueue(makeRequest('b'));
    queue.clear();
    expect(queue.isEmpty).toBe(true);
  });
});

