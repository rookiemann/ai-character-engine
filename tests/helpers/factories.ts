/**
 * Shared test factories and mock builders.
 * Used across all unit test files for consistent mock creation.
 */
import type {
  CharacterState,
  ToolDefinition,
  MemoryRecord,
  GameEvent,
  InferenceResponse,
  WorkingMemoryEntry,
  CharacterSummaryRecord,
} from '../../src/core/types';

export function makeChar(id: string, name: string, overrides?: Partial<CharacterState>): CharacterState {
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
    ...overrides,
  };
}

export function createMockRegistry(chars: CharacterState[] = []) {
  const charMap = new Map(chars.map(c => [c.id, c]));
  return {
    get(id: string) { return charMap.get(id) ?? null; },
    getAll() { return [...charMap.values()]; },
    register(def: any) {
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
    _map: charMap,
  } as any;
}

export function createMockEmitter() {
  const emitted: Array<{ event: string; args: any[] }> = [];
  return {
    emit(event: string, ...args: any[]) { emitted.push({ event, args }); },
    on() {},
    off() {},
    emitted,
  } as any;
}

export function makeToolDef(name: string, params?: ToolDefinition['parameters']): ToolDefinition {
  return {
    name,
    description: `The ${name} tool`,
    parameters: params ?? [
      { name: 'target', type: 'string', description: 'Target', required: true },
    ],
  };
}

export function makeMemoryRecord(id: string, overrides?: Partial<MemoryRecord>): MemoryRecord {
  return {
    id,
    characterId: 'char1',
    playerId: 'default',
    type: 'observation',
    content: `Memory content for ${id}`,
    summary: `Summary of ${id}`,
    importance: 5,
    currentImportance: 5,
    isDeep: false,
    isPermanent: false,
    tags: ['test'],
    decayRate: 1.0,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    ...overrides,
  };
}

export function makeGameEvent(type: string, overrides?: Partial<GameEvent>): GameEvent {
  return {
    type,
    timestamp: Date.now(),
    ...overrides,
  };
}

export function makeInferenceResponse(content: string, toolCalls?: InferenceResponse['toolCalls']): InferenceResponse {
  return {
    content,
    toolCalls,
    tokensUsed: { prompt: 100, completion: 50, total: 150 },
    model: 'test-model',
    durationMs: 100,
  };
}

export function makeWorkingMemory(id: string, content: string, overrides?: Partial<WorkingMemoryEntry>): WorkingMemoryEntry {
  return {
    id,
    characterId: 'char1',
    playerId: 'default',
    role: 'user',
    content,
    turnIndex: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

export function makeSummaryRecord(characterId: string, overrides?: Partial<CharacterSummaryRecord>): CharacterSummaryRecord {
  return {
    id: `sum_${characterId}`,
    characterId,
    playerId: 'default',
    summary: 'A brave warrior who protects the realm',
    relationshipNotes: 'Trusts the player',
    keyFacts: ['Strong fighter', 'Lost a friend'],
    version: 1,
    generatedAt: Date.now(),
    ...overrides,
  };
}
