import EventEmitter from 'eventemitter3';
import type {
  AgentDecisionResult,
  CharacterState,
  GameEvent,
  MemoryRecord,
  ProximityScore,
  ChatMessage,
} from './types';

export interface EngineEvents {
  // Agent events
  'agent:decision': (result: AgentDecisionResult) => void;
  'agent:error': (characterId: string, error: Error) => void;

  // Memory events
  'memory:created': (memory: MemoryRecord) => void;
  'memory:pruned': (characterId: string, count: number) => void;
  'memory:summaryUpdated': (characterId: string) => void;

  // Proximity events
  'proximity:changed': (score: ProximityScore) => void;
  'proximity:tierChanged': (characterId: string, oldTier: string, newTier: string) => void;

  // Tick events
  'tick:fast': (timestamp: number) => void;
  'tick:slow': (timestamp: number) => void;

  // Game events
  'game:event': (event: GameEvent) => void;

  // Chat events
  'chat:message': (message: ChatMessage) => void;

  // Character events
  'character:registered': (character: CharacterState) => void;
  'character:removed': (characterId: string) => void;
  'character:died': (characterId: string, cause: string) => void;
  'character:spawned': (character: CharacterState, replacedId?: string) => void;
  'phase:changed': (oldPhase: string, newPhase: string) => void;

  // Social events
  'gossip:spread': (fromId: string, toId: string, gossipId: string) => void;
  'reputation:changed': (characterId: string, dimension: string, delta: number) => void;

  // Hierarchy events
  'hierarchy:rankChanged': (characterId: string, factionId: string, oldRank: number, newRank: number) => void;
  'hierarchy:orderIssued': (fromId: string, toId: string, factionId: string) => void;
  'hierarchy:succession': (factionId: string, characterId: string, newRank: number) => void;

  // Engine lifecycle
  'engine:started': () => void;
  'engine:stopped': () => void;
  'engine:error': (error: Error) => void;
}

export class TypedEventEmitter extends EventEmitter<EngineEvents> {}

let globalEmitter: TypedEventEmitter | null = null;

export function getEmitter(): TypedEventEmitter {
  if (!globalEmitter) {
    globalEmitter = new TypedEventEmitter();
  }
  return globalEmitter;
}

export function createEmitter(): TypedEventEmitter {
  return new TypedEventEmitter();
}
