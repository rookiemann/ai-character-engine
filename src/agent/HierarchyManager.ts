import type {
  HierarchyDefinition,
  HierarchyRankDef,
  HierarchyMembership,
  HierarchyOrder,
  Persistable,
} from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import type { AgentRegistry } from './AgentRegistry';
import type { RelationshipManager } from './RelationshipManager';
import type { ReputationManager } from './ReputationManager';
import type { GamePlugin } from '../plugin/GamePlugin';
import { TypedEventEmitter } from '../core/events';
import { getLogger } from '../core/logger';

/**
 * Expansion 38: Hierarchy System
 *
 * Manages factions, ranks, chain-of-command, orders between characters,
 * and succession when a leader dies. Games define rank structures via
 * HierarchyDefinition; the engine handles membership, authority checks,
 * and auto-promotion.
 */
export class HierarchyManager implements Persistable {
  private factions = new Map<string, HierarchyDefinition>();
  private memberships = new Map<string, HierarchyMembership[]>(); // factionId → members
  private orders = new Map<string, HierarchyOrder>();              // orderId → order
  private log = getLogger('hierarchy-manager');

  constructor(
    private registry: AgentRegistry,
    private relationships: RelationshipManager,
    private reputation: ReputationManager,
    private emitter: TypedEventEmitter,
  ) {}

  // === Faction Management ===

  defineFaction(def: HierarchyDefinition): void {
    // Sort ranks by level ascending for consistency
    const sorted = [...def.ranks].sort((a, b) => a.level - b.level);
    this.factions.set(def.factionId, { ...def, ranks: sorted });
    if (!this.memberships.has(def.factionId)) {
      this.memberships.set(def.factionId, []);
    }
    this.log.info({ factionId: def.factionId, name: def.factionName, ranks: sorted.length }, 'Faction defined');
  }

  getFaction(factionId: string): HierarchyDefinition | undefined {
    return this.factions.get(factionId);
  }

  getAllFactions(): HierarchyDefinition[] {
    return [...this.factions.values()];
  }

  // === Membership ===

  setRank(characterId: string, factionId: string, rankLevel: number): void {
    const faction = this.factions.get(factionId);
    if (!faction) {
      this.log.warn({ factionId }, 'Cannot set rank: faction not found');
      return;
    }

    const rankDef = faction.ranks.find(r => r.level === rankLevel);
    if (!rankDef) {
      this.log.warn({ factionId, rankLevel }, 'Cannot set rank: rank level not defined');
      return;
    }

    // Check maxMembers constraint
    if (rankDef.maxMembers !== undefined) {
      const members = this.memberships.get(factionId) ?? [];
      const atRank = members.filter(m => m.rankLevel === rankLevel && m.characterId !== characterId);
      if (atRank.length >= rankDef.maxMembers) {
        this.log.warn({ factionId, rankLevel, max: rankDef.maxMembers }, 'Cannot set rank: maxMembers exceeded');
        return;
      }
    }

    const members = this.memberships.get(factionId) ?? [];
    const existing = members.find(m => m.characterId === characterId);
    const oldRank = existing?.rankLevel ?? -1;

    if (existing) {
      existing.rankLevel = rankLevel;
      existing.assignedAt = Date.now();
    } else {
      members.push({
        characterId,
        factionId,
        rankLevel,
        assignedAt: Date.now(),
      });
      this.memberships.set(factionId, members);
    }

    if (oldRank !== rankLevel) {
      this.emitter.emit('hierarchy:rankChanged', characterId, factionId, oldRank, rankLevel);
      this.log.debug({ characterId, factionId, oldRank, newRank: rankLevel }, 'Rank changed');
    }
  }

  getMembership(characterId: string, factionId: string): HierarchyMembership | null {
    const members = this.memberships.get(factionId) ?? [];
    return members.find(m => m.characterId === characterId) ?? null;
  }

  getCharacterFactions(characterId: string): HierarchyMembership[] {
    const result: HierarchyMembership[] = [];
    for (const members of this.memberships.values()) {
      for (const m of members) {
        if (m.characterId === characterId) result.push(m);
      }
    }
    return result;
  }

  getFactionMembers(factionId: string): HierarchyMembership[] {
    return [...(this.memberships.get(factionId) ?? [])];
  }

  removeMember(characterId: string, factionId: string): void {
    const members = this.memberships.get(factionId);
    if (!members) return;
    const idx = members.findIndex(m => m.characterId === characterId);
    if (idx >= 0) {
      members.splice(idx, 1);
    }

    // Revoke any orders to/from this character in this faction
    for (const order of this.orders.values()) {
      if (order.factionId === factionId && order.active &&
          (order.fromCharacterId === characterId || order.toCharacterId === characterId)) {
        order.active = false;
      }
    }
  }

  // === Chain of Command ===

  getSuperiors(characterId: string, factionId: string): HierarchyMembership[] {
    const membership = this.getMembership(characterId, factionId);
    if (!membership) return [];
    const members = this.memberships.get(factionId) ?? [];
    return members.filter(m => m.rankLevel < membership.rankLevel);
  }

  getDirectSuperiors(characterId: string, factionId: string): HierarchyMembership[] {
    const membership = this.getMembership(characterId, factionId);
    if (!membership) return [];
    const members = this.memberships.get(factionId) ?? [];
    return members.filter(m => m.rankLevel === membership.rankLevel - 1);
  }

  getSubordinates(characterId: string, factionId: string): HierarchyMembership[] {
    const membership = this.getMembership(characterId, factionId);
    if (!membership) return [];
    const members = this.memberships.get(factionId) ?? [];
    return members.filter(m => m.rankLevel > membership.rankLevel);
  }

  getDirectSubordinates(characterId: string, factionId: string): HierarchyMembership[] {
    const membership = this.getMembership(characterId, factionId);
    if (!membership) return [];
    const members = this.memberships.get(factionId) ?? [];
    return members.filter(m => m.rankLevel === membership.rankLevel + 1);
  }

  getRankName(factionId: string, rankLevel: number): string {
    const faction = this.factions.get(factionId);
    if (!faction) return `Rank ${rankLevel}`;
    return faction.ranks.find(r => r.level === rankLevel)?.name ?? `Rank ${rankLevel}`;
  }

  // === Orders ===

  issueOrder(
    from: string,
    to: string,
    factionId: string,
    instruction: string,
    scope: string,
    expiresAt?: number,
  ): HierarchyOrder | null {
    const fromMembership = this.getMembership(from, factionId);
    const toMembership = this.getMembership(to, factionId);

    if (!fromMembership || !toMembership) {
      this.log.warn({ from, to, factionId }, 'Cannot issue order: one or both not in faction');
      return null;
    }

    // Authority check: from must outrank to (lower rankLevel = higher authority)
    if (fromMembership.rankLevel >= toMembership.rankLevel) {
      this.log.warn({ from, to, factionId, fromRank: fromMembership.rankLevel, toRank: toMembership.rankLevel },
        'Cannot issue order: insufficient authority');
      return null;
    }

    const order: HierarchyOrder = {
      id: `hord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromCharacterId: from,
      toCharacterId: to,
      factionId,
      instruction,
      scope,
      active: true,
      createdAt: Date.now(),
      expiresAt,
    };

    this.orders.set(order.id, order);
    this.emitter.emit('hierarchy:orderIssued', from, to, factionId);
    this.log.debug({ orderId: order.id, from, to, factionId }, 'Order issued');
    return order;
  }

  getActiveOrders(characterId: string): HierarchyOrder[] {
    const result: HierarchyOrder[] = [];
    for (const order of this.orders.values()) {
      if (order.toCharacterId === characterId && order.active) {
        result.push(order);
      }
    }
    return result;
  }

  getIssuedOrders(characterId: string): HierarchyOrder[] {
    const result: HierarchyOrder[] = [];
    for (const order of this.orders.values()) {
      if (order.fromCharacterId === characterId && order.active) {
        result.push(order);
      }
    }
    return result;
  }

  revokeOrder(orderId: string): void {
    const order = this.orders.get(orderId);
    if (order) {
      order.active = false;
    }
  }

  expireOrders(): void {
    const now = Date.now();
    for (const order of this.orders.values()) {
      if (order.active && order.expiresAt && order.expiresAt <= now) {
        order.active = false;
      }
    }
  }

  // === Promotion / Demotion ===

  promote(characterId: string, factionId: string): boolean {
    const membership = this.getMembership(characterId, factionId);
    if (!membership) return false;

    const faction = this.factions.get(factionId);
    if (!faction) return false;

    // Find the next higher rank (lower level number)
    const sortedRanks = [...faction.ranks].sort((a, b) => a.level - b.level);
    const currentIdx = sortedRanks.findIndex(r => r.level === membership.rankLevel);
    if (currentIdx <= 0) return false; // Already at top or not found

    const targetRank = sortedRanks[currentIdx - 1];

    // Check maxMembers
    if (targetRank.maxMembers !== undefined) {
      const members = this.memberships.get(factionId) ?? [];
      const atRank = members.filter(m => m.rankLevel === targetRank.level);
      if (atRank.length >= targetRank.maxMembers) return false;
    }

    const oldRank = membership.rankLevel;
    membership.rankLevel = targetRank.level;
    membership.assignedAt = Date.now();

    this.emitter.emit('hierarchy:rankChanged', characterId, factionId, oldRank, targetRank.level);
    this.log.debug({ characterId, factionId, oldRank, newRank: targetRank.level }, 'Promoted');
    return true;
  }

  demote(characterId: string, factionId: string): boolean {
    const membership = this.getMembership(characterId, factionId);
    if (!membership) return false;

    const faction = this.factions.get(factionId);
    if (!faction) return false;

    // Find the next lower rank (higher level number)
    const sortedRanks = [...faction.ranks].sort((a, b) => a.level - b.level);
    const currentIdx = sortedRanks.findIndex(r => r.level === membership.rankLevel);
    if (currentIdx < 0 || currentIdx >= sortedRanks.length - 1) return false; // Already at bottom or not found

    const targetRank = sortedRanks[currentIdx + 1];
    const oldRank = membership.rankLevel;
    membership.rankLevel = targetRank.level;
    membership.assignedAt = Date.now();

    this.emitter.emit('hierarchy:rankChanged', characterId, factionId, oldRank, targetRank.level);
    this.log.debug({ characterId, factionId, oldRank, newRank: targetRank.level }, 'Demoted');
    return true;
  }

  // === Succession ===

  handleSuccession(
    characterId: string,
    factionId: string,
    plugin: GamePlugin | null,
  ): string | null {
    const membership = this.getMembership(characterId, factionId);
    if (!membership) return null;

    const vacatedRank = membership.rankLevel;
    const candidates = this.getPromotionCandidates(factionId, vacatedRank);

    if (candidates.length === 0) {
      this.log.info({ factionId, vacatedRank }, 'No succession candidates available');
      return null;
    }

    // 1. Plugin gets first choice
    let promotedId: string | null = null;
    if (plugin?.onSuccession) {
      promotedId = plugin.onSuccession(factionId, vacatedRank, candidates) ?? null;
      // Validate plugin choice is a real candidate
      if (promotedId && !candidates.some(c => c.characterId === promotedId)) {
        this.log.warn({ promotedId, factionId }, 'Plugin returned invalid succession candidate, falling back');
        promotedId = null;
      }
    }

    // 2. Fallback: auto-promote top scorer
    if (!promotedId) {
      promotedId = candidates[0].characterId;
    }

    // Remove dying character from the rank first so maxMembers check passes
    this.removeMember(characterId, factionId);

    // Promote the chosen character
    this.setRank(promotedId, factionId, vacatedRank);

    this.emitter.emit('hierarchy:succession', factionId, promotedId, vacatedRank);
    this.log.info({ factionId, promotedId, rank: vacatedRank }, 'Succession completed');
    return promotedId;
  }

  getPromotionCandidates(
    factionId: string,
    targetRank: number,
  ): Array<{ characterId: string; score: number }> {
    const members = this.memberships.get(factionId) ?? [];

    // Find the next rank below the vacancy (rank + 1 level)
    const faction = this.factions.get(factionId);
    if (!faction) return [];

    const sortedRanks = [...faction.ranks].sort((a, b) => a.level - b.level);
    const targetIdx = sortedRanks.findIndex(r => r.level === targetRank);
    if (targetIdx < 0 || targetIdx >= sortedRanks.length - 1) return [];

    const candidateRankLevel = sortedRanks[targetIdx + 1].level;
    const candidates = members.filter(m => m.rankLevel === candidateRankLevel);

    if (candidates.length === 0) return [];

    const now = Date.now();
    const scored = candidates.map(c => {
      // Reputation score: normalize from [-100, +100] to [0, 1]
      const rep = this.reputation.getReputation(c.characterId);
      const generalRep = rep.scores.general ?? 0;
      const reputationScore = Math.max(0, Math.min(1, generalRep / 200 + 0.5));

      // Trust score: average trust from same-faction peers
      const factionMemberIds = members
        .filter(m => m.characterId !== c.characterId)
        .map(m => m.characterId);
      let trustScore = 0.5; // default if no peers
      if (factionMemberIds.length > 0) {
        const rels = this.relationships.getRelationships(c.characterId);
        let trustSum = 0;
        let trustCount = 0;
        for (const rel of rels) {
          const peerId = rel.fromId === c.characterId ? rel.toId : rel.fromId;
          if (factionMemberIds.includes(peerId)) {
            trustSum += rel.trust;
            trustCount++;
          }
        }
        if (trustCount > 0) {
          trustScore = Math.max(0, Math.min(1, (trustSum / trustCount) / 100));
        }
      }

      // Seniority score: days in faction, capped at 30
      const daysInFaction = (now - c.assignedAt) / (1000 * 60 * 60 * 24);
      const seniorityScore = Math.min(1, daysInFaction / 30);

      const score = reputationScore * 0.4 + trustScore * 0.3 + seniorityScore * 0.3;
      return { characterId: c.characterId, score };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  // === Prompt ===

  getHierarchyPrompt(characterId: string): string | null {
    const factions = this.getCharacterFactions(characterId);
    if (factions.length === 0) return null;

    const parts: string[] = [];

    for (const membership of factions) {
      const faction = this.factions.get(membership.factionId);
      if (!faction) continue;

      const rankName = this.getRankName(membership.factionId, membership.rankLevel);
      let line = `Rank: ${rankName} (${membership.rankLevel}) in ${faction.factionName}.`;

      // Superiors
      const superiors = this.getDirectSuperiors(characterId, membership.factionId);
      if (superiors.length > 0) {
        const names = superiors.map(s => {
          const char = this.registry.get(s.characterId);
          return char?.name ?? s.characterId;
        });
        line += ` Above: ${names.join(', ')}.`;
      }

      // Subordinates
      const subordinates = this.getDirectSubordinates(characterId, membership.factionId);
      if (subordinates.length > 0) {
        const names = subordinates.map(s => {
          const char = this.registry.get(s.characterId);
          const rName = this.getRankName(membership.factionId, s.rankLevel);
          return `${char?.name ?? s.characterId} (${rName})`;
        });
        line += ` Below: ${names.join(', ')}.`;
      }

      parts.push(line);
    }

    // Active orders
    const activeOrders = this.getActiveOrders(characterId);
    for (const order of activeOrders) {
      const fromChar = this.registry.get(order.fromCharacterId);
      const fromName = fromChar?.name ?? order.fromCharacterId;
      parts.push(`Order from ${fromName}: ${order.instruction}`);
    }

    return parts.length > 0 ? parts.join(' ') : null;
  }

  // === Cleanup ===

  clearCharacter(characterId: string): void {
    // Remove from all factions
    for (const [factionId, members] of this.memberships) {
      const idx = members.findIndex(m => m.characterId === characterId);
      if (idx >= 0) members.splice(idx, 1);
    }

    // Deactivate all orders involving this character
    for (const order of this.orders.values()) {
      if (order.active &&
          (order.fromCharacterId === characterId || order.toCharacterId === characterId)) {
        order.active = false;
      }
    }
  }

  // === Persistence ===

  saveState(repo: StateRepository): void {
    // Save faction definitions
    repo.clearHierarchyDefinitions();
    const defs: Array<{
      factionId: string; factionName: string; ranks: string;
      metadata: string; createdAt: number;
    }> = [];
    for (const faction of this.factions.values()) {
      defs.push({
        factionId: faction.factionId,
        factionName: faction.factionName,
        ranks: JSON.stringify(faction.ranks),
        metadata: JSON.stringify(faction.metadata ?? {}),
        createdAt: Date.now(),
      });
    }
    if (defs.length > 0) repo.saveHierarchyDefinitions(defs);

    // Save memberships
    repo.clearHierarchyMemberships();
    const mems: Array<{
      characterId: string; factionId: string; rankLevel: number; assignedAt: number;
    }> = [];
    for (const members of this.memberships.values()) {
      for (const m of members) {
        mems.push({
          characterId: m.characterId,
          factionId: m.factionId,
          rankLevel: m.rankLevel,
          assignedAt: m.assignedAt,
        });
      }
    }
    if (mems.length > 0) repo.saveHierarchyMemberships(mems);

    // Save orders (only active ones to keep DB clean)
    repo.clearHierarchyOrders();
    const ords: Array<{
      id: string; fromCharacterId: string; toCharacterId: string;
      factionId: string; instruction: string; scope: string;
      active: boolean; createdAt: number; expiresAt?: number;
    }> = [];
    for (const order of this.orders.values()) {
      if (order.active) {
        ords.push({ ...order });
      }
    }
    if (ords.length > 0) repo.saveHierarchyOrders(ords);
  }

  loadState(repo: StateRepository): void {
    // Load faction definitions
    const defRows = repo.loadAllHierarchyDefinitions();
    this.factions.clear();
    for (const r of defRows) {
      const ranks: HierarchyRankDef[] = JSON.parse(r.ranks);
      const metadata: Record<string, unknown> = JSON.parse(r.metadata);
      this.factions.set(r.factionId, {
        factionId: r.factionId,
        factionName: r.factionName,
        ranks,
        metadata,
      });
    }

    // Load memberships
    this.memberships.clear();
    const memRows = repo.loadAllHierarchyMemberships();
    for (const r of memRows) {
      if (!this.memberships.has(r.factionId)) {
        this.memberships.set(r.factionId, []);
      }
      this.memberships.get(r.factionId)!.push({
        characterId: r.characterId,
        factionId: r.factionId,
        rankLevel: r.rankLevel,
        assignedAt: r.assignedAt,
      });
    }

    // Ensure all factions have a memberships entry
    for (const factionId of this.factions.keys()) {
      if (!this.memberships.has(factionId)) {
        this.memberships.set(factionId, []);
      }
    }

    // Load orders
    this.orders.clear();
    const ordRows = repo.loadAllHierarchyOrders();
    for (const r of ordRows) {
      this.orders.set(r.id, {
        id: r.id,
        fromCharacterId: r.fromCharacterId,
        toCharacterId: r.toCharacterId,
        factionId: r.factionId,
        instruction: r.instruction,
        scope: r.scope,
        active: r.active,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      });
    }

    this.log.debug({
      factions: this.factions.size,
      memberships: memRows.length,
      orders: this.orders.size,
    }, 'Hierarchy state loaded from DB');
  }
}
