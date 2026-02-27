import { describe, it, expect, beforeEach } from 'vitest';

import { PerceptionManager } from '../../src/agent/PerceptionManager';
import { NeedsManager } from '../../src/agent/NeedsManager';
import { RoutineManager } from '../../src/agent/RoutineManager';
import { LifecycleManager } from '../../src/agent/LifecycleManager';
import { InitiativeChecker } from '../../src/agent/InitiativeChecker';
import { EmotionManager } from '../../src/agent/EmotionManager';
import { GoalPlanner } from '../../src/agent/GoalPlanner';
import { RelationshipManager } from '../../src/agent/RelationshipManager';

import type {
  GameEvent,
  CharacterState,
  RoutineActivity,
} from '../../src/core/types';

// ============================================
// Mock AgentRegistry (minimal)
// ============================================
function createMockRegistry(chars: CharacterState[] = []) {
  const charMap = new Map(chars.map(c => [c.id, c]));
  return {
    get(id: string) { return charMap.get(id) ?? null; },
    getAll() { return [...charMap.values()]; },
    register(def: any, playerId?: string) {
      const state: CharacterState = {
        id: def.id,
        name: def.name,
        archetype: def.archetype,
        identity: def.identity,
        activityTier: 'dormant',
        closeness: 0,
        highWaterMark: 0,
        metadata: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      charMap.set(state.id, state);
      return state;
    },
    remove(id: string) { charMap.delete(id); },
    update() {},
  } as any;
}

// Mock emitter
function createMockEmitter() {
  const emitted: Array<{ event: string; args: any[] }> = [];
  return {
    emit(event: string, ...args: any[]) { emitted.push({ event, args }); },
    on() {},
    off() {},
    emitted,
  } as any;
}

function makeChar(id: string, name: string): CharacterState {
  return {
    id,
    name,
    archetype: 'warrior',
    identity: { personality: 'brave', backstory: '', goals: [], traits: ['bold'] },
    activityTier: 'active',
    closeness: 50,
    highWaterMark: 50,
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ============================================
// Expansion 29: Perception System
// ============================================

describe('PerceptionManager', () => {
  let perception: PerceptionManager;
  let registry: any;

  beforeEach(() => {
    const chars = [makeChar('char1', 'Elara'), makeChar('char2', 'Marcus'), makeChar('char3', 'Lyra')];
    registry = createMockRegistry(chars);
    perception = new PerceptionManager(registry);
  });

  it('should track character locations', () => {
    perception.updateLocation('char1', 'marketplace');
    expect(perception.getLocation('char1')).toBe('marketplace');
  });

  it('should find characters at same location', () => {
    perception.updateLocation('char1', 'marketplace');
    perception.updateLocation('char2', 'marketplace');
    perception.updateLocation('char3', 'tavern');

    const atMarket = perception.getCharactersAtLocation('marketplace');
    expect(atMarket).toContain('char1');
    expect(atMarket).toContain('char2');
    expect(atMarket).not.toContain('char3');
  });

  it('should update nearby characters on location change', () => {
    perception.updateLocation('char1', 'marketplace');
    perception.updateLocation('char2', 'marketplace');

    // char1 perceives char2 nearby
    const prompt = perception.getPerceptionPrompt('char1');
    expect(prompt).toContain('Marcus');
  });

  it('should filter events by location', () => {
    perception.updateLocation('char1', 'marketplace');
    perception.updateLocation('char2', 'marketplace');
    perception.updateLocation('char3', 'tavern');

    const event: GameEvent = {
      type: 'explosion',
      data: { location: 'marketplace' },
      importance: 8,
      timestamp: Date.now(),
    };

    const filtered = perception.filterByPerception(event, ['char1', 'char2', 'char3']);
    expect(filtered).toContain('char1');
    expect(filtered).toContain('char2');
    expect(filtered).not.toContain('char3');
  });

  it('should broadcast events without a location', () => {
    perception.updateLocation('char1', 'marketplace');
    perception.updateLocation('char3', 'tavern');

    const event: GameEvent = {
      type: 'announcement',
      importance: 5,
      timestamp: Date.now(),
    };

    const filtered = perception.filterByPerception(event, ['char1', 'char3']);
    expect(filtered).toHaveLength(2);
  });

  it('should record and retrieve perceptions', () => {
    perception.recordPerception('char1', {
      type: 'event',
      id: 'e1',
      description: 'sounds of combat',
      location: 'marketplace',
      timestamp: Date.now(),
    });

    const recent = perception.getRecentPerceptions('char1');
    expect(recent).toHaveLength(1);
    expect(recent[0].description).toBe('sounds of combat');
  });

  it('should build perception prompt with nearby chars and perceptions', () => {
    perception.updateLocation('char1', 'marketplace');
    perception.updateLocation('char2', 'marketplace');
    perception.recordPerception('char1', {
      type: 'event',
      id: 'e1',
      description: 'sounds of combat',
      location: 'marketplace',
      timestamp: Date.now(),
    });

    const prompt = perception.getPerceptionPrompt('char1');
    expect(prompt).toContain('Marcus');
    expect(prompt).toContain('sounds of combat');
  });

  it('should clear character data', () => {
    perception.updateLocation('char1', 'marketplace');
    perception.updateLocation('char2', 'marketplace');
    perception.clearCharacter('char1');

    expect(perception.getLocation('char1')).toBeNull();
    expect(perception.getCharactersAtLocation('marketplace')).toEqual(['char2']);
  });

  it('should handle location changes cleanly', () => {
    perception.updateLocation('char1', 'marketplace');
    perception.updateLocation('char2', 'marketplace');
    perception.updateLocation('char1', 'tavern');

    expect(perception.getCharactersAtLocation('marketplace')).toEqual(['char2']);
    expect(perception.getCharactersAtLocation('tavern')).toEqual(['char1']);
  });
});

// ============================================
// Expansion 30: Needs System
// ============================================

describe('NeedsManager', () => {
  let needs: NeedsManager;

  beforeEach(() => {
    needs = new NeedsManager();
  });

  it('should auto-initialize needs from registered types', () => {
    const charNeeds = needs.getNeeds('char1');
    expect(charNeeds.needs.length).toBeGreaterThanOrEqual(5);
    const types = charNeeds.needs.map(n => n.type);
    expect(types).toContain('rest');
    expect(types).toContain('social');
    expect(types).toContain('sustenance');
    expect(types).toContain('safety');
    expect(types).toContain('purpose');
  });

  it('should start all needs at 0 intensity', () => {
    const charNeeds = needs.getNeeds('char1');
    for (const need of charNeeds.needs) {
      expect(need.intensity).toBe(0);
    }
  });

  it('should grow needs on growAll()', () => {
    needs.getNeeds('char1'); // initialize
    for (let i = 0; i < 100; i++) {
      needs.growAll();
    }
    const rest = needs.getNeed('char1', 'rest')!;
    expect(rest.intensity).toBeGreaterThan(0.2);
  });

  it('should fulfill needs via tool result', () => {
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'rest', 0.8);
    needs.processToolResult('char1', 'rest');
    const rest = needs.getNeed('char1', 'rest')!;
    expect(rest.intensity).toBeLessThan(0.8);
  });

  it('should fulfill needs via game event', () => {
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'social', 0.6);
    needs.processEvent('char1', { type: 'dialogue', timestamp: Date.now() });
    const social = needs.getNeed('char1', 'social')!;
    expect(social.intensity).toBeLessThan(0.6);
  });

  it('should generate needs prompt for significant needs', () => {
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'rest', 0.8);
    needs.setNeedIntensity('char1', 'social', 0.4);

    const prompt = needs.getNeedsPrompt('char1');
    expect(prompt).toContain('desperately need rest');
    expect(prompt).toContain('could use some company');
  });

  it('should return null prompt when all needs are low', () => {
    needs.getNeeds('char1');
    const prompt = needs.getNeedsPrompt('char1');
    expect(prompt).toBeNull();
  });

  it('should return critical needs above threshold', () => {
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'rest', 0.9);
    needs.setNeedIntensity('char1', 'social', 0.3);

    const critical = needs.getCriticalNeeds('char1', 0.7);
    expect(critical).toHaveLength(1);
    expect(critical[0].type).toBe('rest');
  });

  it('should clamp intensity between 0 and 1', () => {
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'rest', 1.5);
    expect(needs.getNeed('char1', 'rest')!.intensity).toBe(1);

    needs.setNeedIntensity('char1', 'rest', -0.5);
    expect(needs.getNeed('char1', 'rest')!.intensity).toBe(0);
  });

  it('should allow registering custom need types', () => {
    needs.registerNeedType({
      type: 'creativity',
      defaultGrowthRate: 0.005,
      defaultDecayOnFulfill: 0.3,
      description: 'creative expression',
    });

    // Existing characters don't get it, but new ones do
    const charNeeds = needs.getNeeds('newchar');
    const types = charNeeds.needs.map(n => n.type);
    expect(types).toContain('creativity');
  });

  it('should clear character data', () => {
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'rest', 0.5);
    needs.clearCharacter('char1');
    // Re-init should start fresh
    const fresh = needs.getNeeds('char1');
    expect(fresh.needs.find(n => n.type === 'rest')!.intensity).toBe(0);
  });
});

// ============================================
// Expansion 31: Routine System
// ============================================

describe('RoutineManager', () => {
  let routines: RoutineManager;

  beforeEach(() => {
    routines = new RoutineManager();
  });

  it('should add and retrieve routines', () => {
    const activities: RoutineActivity[] = [
      { phase: 'morning', activity: 'trading at marketplace', location: 'marketplace', priority: 5 },
      { phase: 'evening', activity: 'resting at tavern', location: 'tavern', priority: 3 },
    ];
    const routine = routines.addRoutine('char1', 'daily', activities, undefined, true);

    expect(routine.characterId).toBe('char1');
    expect(routine.isDefault).toBe(true);
    expect(routines.getRoutines('char1')).toHaveLength(1);
  });

  it('should return current activity based on phase', () => {
    const activities: RoutineActivity[] = [
      { phase: 'morning', activity: 'trading at marketplace', priority: 5 },
      { phase: 'evening', activity: 'resting at tavern', priority: 3 },
    ];
    routines.addRoutine('char1', 'daily', activities, undefined, true);

    routines.updatePhase('morning');
    const activity = routines.getCurrentActivity('char1');
    expect(activity?.activity).toBe('trading at marketplace');
  });

  it('should return highest priority activity for a phase', () => {
    const activities: RoutineActivity[] = [
      { phase: 'morning', activity: 'patrol', priority: 3 },
      { phase: 'morning', activity: 'training', priority: 8 },
    ];
    routines.addRoutine('char1', 'daily', activities, undefined, true);
    routines.updatePhase('morning');

    const activity = routines.getCurrentActivity('char1');
    expect(activity?.activity).toBe('training');
  });

  it('should generate routine prompt', () => {
    const activities: RoutineActivity[] = [
      { phase: 'morning', activity: 'trading at marketplace', location: 'marketplace', priority: 5 },
    ];
    routines.addRoutine('char1', 'daily', activities, undefined, true);
    routines.updatePhase('morning');

    const prompt = routines.getRoutinePrompt('char1');
    expect(prompt).toContain('trading at marketplace');
    expect(prompt).toContain('morning');
    expect(prompt).toContain('marketplace');
  });

  it('should return null prompt when no matching phase', () => {
    const activities: RoutineActivity[] = [
      { phase: 'morning', activity: 'trading', priority: 5 },
    ];
    routines.addRoutine('char1', 'daily', activities, undefined, true);
    routines.updatePhase('evening');

    const prompt = routines.getRoutinePrompt('char1');
    expect(prompt).toBeNull();
  });

  it('should prefer conditional routine over default', () => {
    routines.addRoutine('char1', 'default', [
      { phase: 'morning', activity: 'idle', priority: 1 },
    ], undefined, true);

    routines.addRoutine('char1', 'rainy-day', [
      { phase: 'morning', activity: 'staying inside', priority: 5 },
    ], { weather: 'rain' });

    routines.updatePhase('morning');
    const activity = routines.getCurrentActivity('char1');
    // Without gameState, uses default
    expect(activity?.activity).toBe('idle');

    // With matching gameState, active routine should match conditional
    const active = routines.getActiveRoutine('char1', { weather: 'rain' });
    expect(active?.name).toBe('rainy-day');
  });

  it('should remove routines', () => {
    const routine = routines.addRoutine('char1', 'daily', [], undefined, true);
    expect(routines.removeRoutine(routine.id)).toBe(true);
    expect(routines.getRoutines('char1')).toHaveLength(0);
  });

  it('should clear character data', () => {
    routines.addRoutine('char1', 'daily', [], undefined, true);
    routines.clearCharacter('char1');
    expect(routines.getRoutines('char1')).toHaveLength(0);
  });
});

// ============================================
// Expansion 32: Lifecycle System
// ============================================

describe('LifecycleManager', () => {
  let lifecycle: LifecycleManager;
  let registry: any;
  let emitter: any;
  let subsystems: any;

  beforeEach(() => {
    const chars = [makeChar('char1', 'Elara'), makeChar('char2', 'Marcus')];
    registry = createMockRegistry(chars);
    emitter = createMockEmitter();
    lifecycle = new LifecycleManager(registry, emitter, {
      respawnDelayMs: 0,
      enableAutoRespawn: true,
    });
    lifecycle.setTargetPopulation(2);

    // Mock subsystems with clearCharacter methods
    subsystems = {
      emotions: new EmotionManager(),
      relationships: { getRelationships: () => [], clearCharacter: () => {} } as any,
      goals: new GoalPlanner(),
      groups: { getCharacterGroups: () => [], removeMember: () => {} } as any,
      routines: new RoutineManager(),
      needs: new NeedsManager(),
      perception: new PerceptionManager(registry),
      proximity: { clearScore: () => {} } as any,
      memory: {} as any,
    };
  });

  it('should kill a character and record death', () => {
    const record = lifecycle.killCharacter('char1', 'combat', subsystems);
    expect(record).not.toBeNull();
    expect(record!.characterId).toBe('char1');
    expect(record!.cause).toBe('combat');
    expect(record!.characterName).toBe('Elara');
  });

  it('should emit character:died event', () => {
    lifecycle.killCharacter('char1', 'combat', subsystems);
    const diedEvents = emitter.emitted.filter((e: any) => e.event === 'character:died');
    expect(diedEvents).toHaveLength(1);
    expect(diedEvents[0].args[0]).toBe('char1');
  });

  it('should remove character from registry on death', () => {
    lifecycle.killCharacter('char1', 'combat', subsystems);
    expect(registry.get('char1')).toBeNull();
  });

  it('should schedule respawn when population drops below target', () => {
    lifecycle.killCharacter('char1', 'combat', subsystems);
    // Population is now 1, target is 2 → should have pending respawn
    const records = lifecycle.getDeathRecords();
    expect(records).toHaveLength(1);
  });

  it('should spawn replacement from plugin', () => {
    lifecycle.killCharacter('char1', 'combat', subsystems);

    const plugin = {
      spawnReplacement: () => ({
        id: 'char_new',
        name: 'New Hero',
        archetype: 'warrior',
        identity: { personality: 'brave', backstory: '', goals: [], traits: [] },
      }),
      getArchetypes: () => [],
      onCharacterAdded: () => {},
    } as any;

    const newChar = lifecycle.spawnReplacement('char1', plugin);
    expect(newChar).not.toBeNull();
    expect(newChar!.name).toBe('New Hero');
  });

  it('should spawn fallback replacement from archetypes', () => {
    lifecycle.killCharacter('char1', 'combat', subsystems);

    const plugin = {
      spawnReplacement: () => null,
      getArchetypes: () => [{
        id: 'warrior',
        name: 'Warrior',
        description: 'A brave fighter',
        defaultIdentity: { personality: 'brave', backstory: '', goals: [], traits: [] },
      }],
      onCharacterAdded: () => {},
    } as any;

    const newChar = lifecycle.spawnReplacement('char1', plugin);
    expect(newChar).not.toBeNull();
    expect(newChar!.archetype).toBe('warrior');
  });

  it('should emit character:spawned on replacement', () => {
    lifecycle.killCharacter('char1', 'combat', subsystems);

    const plugin = {
      spawnReplacement: () => ({
        id: 'char_new',
        name: 'New Hero',
        archetype: 'warrior',
        identity: { personality: 'brave', backstory: '', goals: [], traits: [] },
      }),
      getArchetypes: () => [],
      onCharacterAdded: () => {},
    } as any;

    lifecycle.spawnReplacement('char1', plugin);
    const spawnEvents = emitter.emitted.filter((e: any) => e.event === 'character:spawned');
    expect(spawnEvents).toHaveLength(1);
  });

  it('should process pending respawns', () => {
    lifecycle.killCharacter('char1', 'combat', subsystems);

    const plugin = {
      spawnReplacement: () => ({
        id: 'char_new',
        name: 'New Hero',
        archetype: 'warrior',
        identity: { personality: 'brave', backstory: '', goals: [], traits: [] },
      }),
      getArchetypes: () => [],
      onCharacterAdded: () => {},
    } as any;

    lifecycle.processPendingRespawns(plugin);
    expect(registry.get('char_new')).not.toBeNull();
  });

  it('should update death record with replacedBy', () => {
    lifecycle.killCharacter('char1', 'combat', subsystems);

    const plugin = {
      spawnReplacement: () => ({
        id: 'char_replacement',
        name: 'New Hero',
        archetype: 'warrior',
        identity: { personality: 'brave', backstory: '', goals: [], traits: [] },
      }),
      getArchetypes: () => [],
      onCharacterAdded: () => {},
    } as any;

    lifecycle.spawnReplacement('char1', plugin);
    const records = lifecycle.getDeathRecords();
    expect(records[0].replacedBy).toBe('char_replacement');
  });

  it('should return null when killing unknown character', () => {
    const record = lifecycle.killCharacter('nonexistent', 'combat', subsystems);
    expect(record).toBeNull();
  });

  it('should track population', () => {
    expect(lifecycle.getPopulation()).toBe(2);
    lifecycle.killCharacter('char1', 'combat', subsystems);
    expect(lifecycle.getPopulation()).toBe(1);
  });

  it('should process character_death events', () => {
    const event: GameEvent = {
      type: 'character_death',
      target: 'char1',
      data: { cause: 'old age' },
      timestamp: Date.now(),
    };

    lifecycle.processDeathEvent(event, null, subsystems);
    expect(registry.get('char1')).toBeNull();
    const records = lifecycle.getDeathRecords();
    expect(records[0].cause).toBe('old age');
  });
});

// ============================================
// InitiativeChecker with Needs
// ============================================

describe('InitiativeChecker with needs', () => {
  let checker: InitiativeChecker;
  let emotions: EmotionManager;
  let goals: GoalPlanner;
  let relationships: RelationshipManager;
  let needs: NeedsManager;

  beforeEach(() => {
    emotions = new EmotionManager();
    goals = new GoalPlanner();
    // RelationshipManager needs a DB, mock it
    relationships = { getRelationships: () => [] } as any;
    needs = new NeedsManager();
    checker = new InitiativeChecker(emotions, goals, relationships, needs);
  });

  it('should trigger initiative for critical needs', () => {
    const char = makeChar('char1', 'Elara');
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'rest', 0.9);

    const event = checker.check(char);
    expect(event).not.toBeNull();
    expect(event!.data?.reason).toBe('critical_need');
    expect(event!.data?.needType).toBe('rest');
  });

  it('should not trigger for low needs', () => {
    const char = makeChar('char1', 'Elara');
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'rest', 0.3);

    const event = checker.check(char);
    // Should be null (no emotion, no goal, no relationship, no critical need)
    expect(event).toBeNull();
  });

  it('should prioritize emotion over critical need', () => {
    const char = makeChar('char1', 'Elara');
    emotions.applyEmotion('char1', 'anger', 0.9);
    needs.getNeeds('char1');
    needs.setNeedIntensity('char1', 'rest', 0.8);

    const event = checker.check(char);
    expect(event).not.toBeNull();
    expect(event!.data?.reason).toBe('emotional_response');
  });
});
