import type {
  GossipItem,
  GameEvent,
  Persistable,
} from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import type { PerceptionManager } from './PerceptionManager';
import type { AgentRegistry } from './AgentRegistry';
import { getEmitter } from '../core/events';
import { getLogger } from '../core/logger';

export interface GossipConfig {
  maxGossipPerCharacter: number;  // default 20
  ttlMs: number;                  // default 300000 (5 min)
  credibilityDecay: number;       // default 0.8 per hop
  minImportanceToCreate: number;  // default 5
  maxGossipItems: number;         // global cap, default 200
}

const DEFAULT_GOSSIP_CONFIG: GossipConfig = {
  maxGossipPerCharacter: 20,
  ttlMs: 300_000,
  credibilityDecay: 0.8,
  minImportanceToCreate: 5,
  maxGossipItems: 200,
};

/**
 * Expansion 35: Gossip System
 *
 * Information propagates through character interactions.
 * When characters use talk_to, they exchange their top rumors.
 * Credibility degrades per hop, and gossip expires over time.
 */
export class GossipManager implements Persistable {
  private gossipItems = new Map<string, GossipItem>();      // id → item
  private characterGossip = new Map<string, Set<string>>(); // charId → Set<gossipId>
  private config: GossipConfig;
  private log = getLogger('gossip-manager');

  constructor(
    private perception: PerceptionManager,
    private registry: AgentRegistry,
    config?: Partial<GossipConfig>,
  ) {
    this.config = { ...DEFAULT_GOSSIP_CONFIG, ...config };
  }

  /**
   * Create gossip from a high-importance game event.
   */
  createFromEvent(event: GameEvent, originCharacterId: string): GossipItem | null {
    const importance = event.importance ?? 0;
    if (importance < this.config.minImportanceToCreate) return null;

    const originChar = this.registry.get(originCharacterId);
    const sourceName = originChar?.name ?? originCharacterId;

    const id = `gossip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const content = `${event.type}: ${event.data?.detail ?? event.data?.description ?? JSON.stringify(event.data ?? {}).slice(0, 100)}`;
    const subject = event.target ?? event.source ?? 'unknown';

    const item: GossipItem = {
      id,
      content,
      source: sourceName,
      subject,
      originCharacterId,
      importance,
      credibility: 1.0,
      spreadCount: 0,
      tags: [event.type],
      createdAt: Date.now(),
    };

    // Enforce global cap (evict oldest)
    if (this.gossipItems.size >= this.config.maxGossipItems) {
      let oldest: GossipItem | null = null;
      for (const g of this.gossipItems.values()) {
        if (!oldest || g.createdAt < oldest.createdAt) oldest = g;
      }
      if (oldest) this.removeGossipItem(oldest.id);
    }

    this.gossipItems.set(id, item);

    // Origin character automatically knows the gossip
    this.addKnowledge(originCharacterId, id);

    this.log.debug({ id, subject, importance }, 'Gossip created from event');
    return item;
  }

  /**
   * Spread gossip bidirectionally during talk_to interactions.
   * A shares top unknown gossip with B, B shares with A.
   */
  spreadBetween(charIdA: string, charIdB: string): void {
    this.spreadOneTo(charIdA, charIdB);
    this.spreadOneTo(charIdB, charIdA);
  }

  /**
   * Get all gossip a character knows, sorted by importance.
   */
  getKnownGossip(characterId: string): GossipItem[] {
    const known = this.characterGossip.get(characterId);
    if (!known || known.size === 0) return [];

    const items: GossipItem[] = [];
    for (const gid of known) {
      const item = this.gossipItems.get(gid);
      if (item) items.push(item);
    }
    return items.sort((a, b) => b.importance - a.importance);
  }

  /**
   * Get gossip char knows that target doesn't.
   */
  getExclusiveGossip(characterId: string, targetId: string): GossipItem[] {
    const myKnown = this.characterGossip.get(characterId);
    const theirKnown = this.characterGossip.get(targetId);
    if (!myKnown || myKnown.size === 0) return [];

    const exclusive: GossipItem[] = [];
    for (const gid of myKnown) {
      if (!theirKnown || !theirKnown.has(gid)) {
        const item = this.gossipItems.get(gid);
        if (item) exclusive.push(item);
      }
    }
    return exclusive.sort((a, b) => b.importance - a.importance);
  }

  /**
   * Give a character knowledge of a specific gossip.
   */
  addKnowledge(characterId: string, gossipId: string): void {
    if (!this.gossipItems.has(gossipId)) return;
    if (!this.characterGossip.has(characterId)) {
      this.characterGossip.set(characterId, new Set());
    }
    const known = this.characterGossip.get(characterId)!;
    known.add(gossipId);

    // Enforce per-character cap (FIFO eviction)
    if (known.size > this.config.maxGossipPerCharacter) {
      const first = known.values().next().value;
      if (first !== undefined) known.delete(first);
    }
  }

  /**
   * Remove expired gossip (TTL + credibility < 0.1). Called on tick:slow.
   */
  expireOldGossip(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, item] of this.gossipItems) {
      if (now - item.createdAt > this.config.ttlMs || item.credibility < 0.1) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.removeGossipItem(id);
    }

    if (toRemove.length > 0) {
      this.log.debug({ expired: toRemove.length }, 'Gossip expired');
    }
  }

  /**
   * LLM prompt hint about what this character has heard.
   */
  getGossipPrompt(characterId: string): string | null {
    const known = this.getKnownGossip(characterId);
    if (known.length === 0) return null;

    const parts: string[] = [];

    // Top 2 rumors
    const top = known.slice(0, 2);
    const rumors = top.map(g => {
      const qualifier = g.credibility > 0.6 ? 'reliable rumor'
        : g.credibility > 0.3 ? 'unconfirmed rumor'
        : 'dubious rumor';
      return `${g.content} (${qualifier})`;
    });
    parts.push(`You've heard: ${rumors.join('; ')}.`);

    return parts.join(' ');
  }

  /**
   * Clear all gossip data for a character.
   */
  clearCharacter(characterId: string): void {
    this.characterGossip.delete(characterId);
  }

  // --- Persistence ---

  saveState(repo: StateRepository): void {
    // Save gossip items
    const items: Array<{
      id: string; content: string; source: string; subject: string;
      originCharacterId: string; importance: number; credibility: number;
      spreadCount: number; tags: string; createdAt: number;
    }> = [];
    for (const item of this.gossipItems.values()) {
      items.push({
        id: item.id,
        content: item.content,
        source: item.source,
        subject: item.subject,
        originCharacterId: item.originCharacterId,
        importance: item.importance,
        credibility: item.credibility,
        spreadCount: item.spreadCount,
        tags: JSON.stringify(item.tags),
        createdAt: item.createdAt,
      });
    }
    repo.clearGossipItems();
    if (items.length > 0) repo.saveGossipItems(items);

    // Save character gossip knowledge
    const charData: Array<{ characterId: string; knownGossip: string }> = [];
    for (const [characterId, known] of this.characterGossip) {
      charData.push({ characterId, knownGossip: JSON.stringify([...known]) });
    }
    repo.clearCharacterGossip();
    if (charData.length > 0) repo.saveCharacterGossip(charData);
  }

  loadState(repo: StateRepository): void {
    // Load gossip items
    const items = repo.loadAllGossipItems();
    this.gossipItems.clear();
    for (const r of items) {
      this.gossipItems.set(r.id, {
        id: r.id,
        content: r.content,
        source: r.source,
        subject: r.subject,
        originCharacterId: r.originCharacterId,
        importance: r.importance,
        credibility: r.credibility,
        spreadCount: r.spreadCount,
        tags: JSON.parse(r.tags),
        createdAt: r.createdAt,
      });
    }

    // Load character gossip knowledge
    const charRows = repo.loadAllCharacterGossip();
    this.characterGossip.clear();
    for (const r of charRows) {
      const ids = JSON.parse(r.knownGossip) as string[];
      this.characterGossip.set(r.characterId, new Set(ids));
    }

    this.log.debug({ items: items.length, characters: charRows.length }, 'Gossip loaded from DB');
  }

  // --- Private ---

  /**
   * Share one character's top unknown gossip with another.
   */
  private spreadOneTo(fromId: string, toId: string): void {
    const fromKnown = this.characterGossip.get(fromId);
    if (!fromKnown || fromKnown.size === 0) return;

    const toKnown = this.characterGossip.get(toId) ?? new Set<string>();

    // Find highest-importance gossip that toId doesn't know
    let best: GossipItem | null = null;
    for (const gid of fromKnown) {
      if (toKnown.has(gid)) continue;
      const item = this.gossipItems.get(gid);
      if (item && (!best || item.importance > best.importance)) {
        best = item;
      }
    }

    if (!best) return;

    // Degrade credibility for the hop
    const degraded: GossipItem = {
      ...best,
      credibility: best.credibility * this.config.credibilityDecay,
      spreadCount: best.spreadCount + 1,
    };
    this.gossipItems.set(best.id, degraded);

    // Give knowledge to recipient
    this.addKnowledge(toId, best.id);

    const emitter = getEmitter();
    emitter.emit('gossip:spread', fromId, toId, best.id);
    this.log.debug({ from: fromId, to: toId, gossipId: best.id }, 'Gossip spread');
  }

  /**
   * Remove a gossip item from all data structures.
   */
  private removeGossipItem(id: string): void {
    this.gossipItems.delete(id);
    for (const known of this.characterGossip.values()) {
      known.delete(id);
    }
  }
}
