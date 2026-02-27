import type {
  ReputationScores,
  ReputationEvent,
  ReputationDimension,
  Persistable,
} from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import type { PerceptionManager } from './PerceptionManager';
import type { AgentRegistry } from './AgentRegistry';
import type { GossipManager } from './GossipManager';
import { getEmitter } from '../core/events';
import { getLogger } from '../core/logger';

export interface ReputationConfig {
  defaultDimensions: ReputationDimension[];
  decayRate: number;    // per slow tick, default 0.1
  maxEvents: number;    // cap, default 500
}

const DEFAULT_REPUTATION_CONFIG: ReputationConfig = {
  defaultDimensions: ['general'],
  decayRate: 0.1,
  maxEvents: 500,
};

/** Tool name → reputation delta mapping (only when witnesses present). */
const TOOL_REPUTATION: Record<string, { dimension: ReputationDimension; delta: number }> = {
  talk_to:     { dimension: 'general', delta: 1 },
  trade:       { dimension: 'general', delta: 2 },
  fight:       { dimension: 'general', delta: -3 },
  attack:      { dimension: 'general', delta: -3 },
  investigate: { dimension: 'general', delta: 1 },
  explore:     { dimension: 'general', delta: 1 },
  craft:       { dimension: 'general', delta: 1 },
};

/** Score → descriptor mapping. */
function getDescriptor(score: number): string {
  if (score <= -50) return 'notorious';
  if (score <= -20) return 'disliked';
  if (score >= 50) return 'legendary';
  if (score >= 20) return 'respected';
  return 'unremarkable';
}

/**
 * Expansion 36: Reputation System
 *
 * Collective knowledge about characters — you can be "known as dangerous"
 * by people you've never met. Witnesses at the same location observe
 * actions and form opinions, which can spread as gossip.
 */
export class ReputationManager implements Persistable {
  private reputations = new Map<string, ReputationScores>();
  private events: ReputationEvent[] = [];
  private config: ReputationConfig;
  private log = getLogger('reputation-manager');

  constructor(
    private perception: PerceptionManager,
    private registry: AgentRegistry,
    config?: Partial<ReputationConfig>,
  ) {
    this.config = { ...DEFAULT_REPUTATION_CONFIG, ...config };
  }

  /**
   * Get reputation (auto-initializes to 0 on all dimensions).
   */
  getReputation(characterId: string): ReputationScores {
    if (!this.reputations.has(characterId)) {
      const scores: Record<ReputationDimension, number> = {};
      for (const dim of this.config.defaultDimensions) {
        scores[dim] = 0;
      }
      this.reputations.set(characterId, { characterId, scores });
    }
    return this.reputations.get(characterId)!;
  }

  /**
   * Change reputation. Optionally creates gossip if gossipManager provided.
   */
  changeReputation(
    characterId: string,
    dimension: ReputationDimension,
    delta: number,
    reason: string,
    witnessIds: string[],
    gossipManager?: GossipManager,
  ): void {
    const rep = this.getReputation(characterId);

    // Apply delta, clamp to -100/+100
    const current = rep.scores[dimension] ?? 0;
    rep.scores[dimension] = Math.max(-100, Math.min(100, current + delta));

    // Record event
    const event: ReputationEvent = {
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      characterId,
      dimension,
      delta,
      reason,
      witnessIds,
      timestamp: Date.now(),
    };
    this.events.push(event);

    // Cap events array
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents);
    }

    // Create gossip for significant reputation changes
    if (gossipManager && Math.abs(delta) >= 3) {
      const charName = this.registry.get(characterId)?.name ?? characterId;
      const gossipEvent = {
        type: 'reputation_change',
        source: characterId,
        target: characterId,
        data: { detail: `${charName}'s reputation as ${dimension} changed: ${reason}` },
        importance: Math.min(10, Math.abs(delta) + 3),
        timestamp: Date.now(),
      };
      const gossipItem = gossipManager.createFromEvent(gossipEvent, witnessIds[0] ?? characterId);
      // All witnesses learn this gossip
      if (gossipItem) {
        for (const wid of witnessIds) {
          gossipManager.addKnowledge(wid, gossipItem.id);
        }
      }
    }

    const emitter = getEmitter();
    emitter.emit('reputation:changed', characterId, dimension, delta);
    this.log.debug({ characterId, dimension, delta, newScore: rep.scores[dimension] }, 'Reputation changed');
  }

  /**
   * Process tool execution → reputation delta based on witnesses at location.
   */
  processToolExecution(
    characterId: string,
    toolName: string,
    toolSucceeded: boolean,
    gossipManager?: GossipManager,
  ): void {
    const mapping = TOOL_REPUTATION[toolName];
    if (!mapping) return;

    // Get character's location
    const location = this.perception.getLocation(characterId);
    if (!location) return;

    // Get witnesses (other characters at same location)
    const allAtLocation = this.perception.getCharactersAtLocation(location);
    const witnesses = allAtLocation.filter(id => id !== characterId);
    if (witnesses.length === 0) return;

    this.changeReputation(
      characterId,
      mapping.dimension,
      mapping.delta,
      `${toolName} (${toolSucceeded ? 'success' : 'failed'})`,
      witnesses,
      gossipManager,
    );
  }

  /**
   * Register custom dimensions from game plugin.
   */
  registerDimensions(dimensions: ReputationDimension[]): void {
    for (const dim of dimensions) {
      if (!this.config.defaultDimensions.includes(dim)) {
        this.config.defaultDimensions.push(dim);
      }
    }
    // Initialize new dimensions for existing reputations
    for (const rep of this.reputations.values()) {
      for (const dim of dimensions) {
        if (!(dim in rep.scores)) {
          rep.scores[dim] = 0;
        }
      }
    }
  }

  /**
   * Decay all reputations toward 0. Called on tick:slow.
   */
  decayAll(): void {
    for (const rep of this.reputations.values()) {
      for (const dim of Object.keys(rep.scores)) {
        const current = rep.scores[dim];
        if (current === 0) continue;
        if (current > 0) {
          rep.scores[dim] = Math.max(0, current - this.config.decayRate);
        } else {
          rep.scores[dim] = Math.min(0, current + this.config.decayRate);
        }
      }
    }
  }

  /**
   * LLM prompt hint about this character's reputation and nearby characters' reputations.
   */
  getReputationPrompt(characterId: string): string | null {
    const parts: string[] = [];

    // Own reputation
    const own = this.reputations.get(characterId);
    if (own) {
      const general = own.scores['general'] ?? 0;
      if (Math.abs(general) >= 5) {
        const desc = getDescriptor(general);
        const sign = general > 0 ? '+' : '';
        parts.push(`Your reputation: ${desc} (${sign}${Math.round(general)}).`);
      }
    }

    // Nearby characters' reputations
    const location = this.perception.getLocation(characterId);
    if (location) {
      const nearby = this.perception.getCharactersAtLocation(location)
        .filter(id => id !== characterId);
      const notable: string[] = [];
      for (const nid of nearby.slice(0, 3)) {
        const rep = this.reputations.get(nid);
        if (!rep) continue;
        const general = rep.scores['general'] ?? 0;
        if (Math.abs(general) >= 10) {
          const name = this.registry.get(nid)?.name ?? nid;
          const desc = getDescriptor(general);
          notable.push(`${name} is known as ${desc} (${general > 0 ? '+' : ''}${Math.round(general)})`);
        }
      }
      if (notable.length > 0) {
        parts.push(`Nearby: ${notable.join('; ')}.`);
      }
    }

    return parts.length > 0 ? parts.join(' ') : null;
  }

  /**
   * Get recent reputation events for a character.
   */
  getRecentEvents(characterId: string, limit: number = 10): ReputationEvent[] {
    return this.events
      .filter(e => e.characterId === characterId)
      .slice(-limit);
  }

  /**
   * Clear all reputation data for a character.
   */
  clearCharacter(characterId: string): void {
    this.reputations.delete(characterId);
    this.events = this.events.filter(e => e.characterId !== characterId);
  }

  // --- Persistence ---

  saveState(repo: StateRepository): void {
    // Save reputations
    const repData: Array<{ characterId: string; scores: string }> = [];
    for (const [characterId, rep] of this.reputations) {
      repData.push({ characterId, scores: JSON.stringify(rep.scores) });
    }
    repo.clearReputation();
    if (repData.length > 0) repo.saveReputation(repData);

    // Save events
    const eventData = this.events.map(e => ({
      id: e.id,
      characterId: e.characterId,
      dimension: e.dimension,
      delta: e.delta,
      reason: e.reason,
      witnessIds: JSON.stringify(e.witnessIds),
      timestamp: e.timestamp,
    }));
    repo.clearReputationEvents();
    if (eventData.length > 0) repo.saveReputationEvents(eventData);
  }

  loadState(repo: StateRepository): void {
    // Load reputations
    const repRows = repo.loadAllReputation();
    this.reputations.clear();
    for (const r of repRows) {
      this.reputations.set(r.characterId, {
        characterId: r.characterId,
        scores: JSON.parse(r.scores),
      });
    }

    // Load events
    const eventRows = repo.loadAllReputationEvents();
    this.events = eventRows.map(r => ({
      id: r.id,
      characterId: r.characterId,
      dimension: r.dimension,
      delta: r.delta,
      reason: r.reason,
      witnessIds: JSON.parse(r.witnessIds),
      timestamp: r.timestamp,
    }));

    this.log.debug({ reputations: repRows.length, events: eventRows.length }, 'Reputation loaded from DB');
  }
}
