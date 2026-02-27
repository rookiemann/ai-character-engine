import type { CharacterRelationship, RelationshipType, GameEvent, Persistable } from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { getLogger } from '../core/logger';
import type { DB } from '../db/database';

/**
 * Expansion 6: Character-to-Character Relationships
 *
 * Manages the relationship matrix between all characters.
 * Relationships are directional (A→B can differ from B→A).
 */
export class RelationshipManager implements Persistable {
  private cache = new Map<string, CharacterRelationship>();
  private interactionCounts = new Map<string, number>();
  private log = getLogger('relationship-manager');

  constructor(private db: DB) {
    // Table is now created via database.ts createTables()
  }

  /**
   * Get or create a relationship between two characters.
   */
  get(fromId: string, toId: string): CharacterRelationship {
    const key = `${fromId}:${toId}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const now = Date.now();
    const rel: CharacterRelationship = {
      fromId,
      toId,
      type: 'neutral',
      strength: 50,
      trust: 50,
      notes: '',
      lastInteractionAt: now,
      updatedAt: now,
    };

    this.cache.set(key, rel);
    return rel;
  }

  /**
   * Update a relationship.
   */
  update(
    fromId: string,
    toId: string,
    changes: Partial<Pick<CharacterRelationship, 'type' | 'strength' | 'trust' | 'notes'>>,
  ): CharacterRelationship {
    const rel = this.get(fromId, toId);

    if (changes.type !== undefined) rel.type = changes.type;
    if (changes.strength !== undefined) rel.strength = Math.max(0, Math.min(100, changes.strength));
    if (changes.trust !== undefined) rel.trust = Math.max(0, Math.min(100, changes.trust));
    if (changes.notes !== undefined) rel.notes = changes.notes;
    rel.updatedAt = Date.now();

    // Auto-determine relationship type from strength
    if (changes.strength !== undefined && changes.type === undefined) {
      rel.type = this.inferType(rel.strength, rel.trust);
    }

    this.cache.set(`${fromId}:${toId}`, rel);
    return rel;
  }

  /**
   * Process an interaction between characters.
   */
  recordInteraction(
    fromId: string,
    toId: string,
    type: 'positive' | 'negative' | 'neutral',
    magnitude: number = 1,
  ): void {
    const rel = this.get(fromId, toId);
    const now = Date.now();

    switch (type) {
      case 'positive':
        rel.strength = Math.min(100, rel.strength + 2 * magnitude);
        rel.trust = Math.min(100, rel.trust + 1 * magnitude);
        break;
      case 'negative':
        rel.strength = Math.max(0, rel.strength - 3 * magnitude);
        rel.trust = Math.max(0, rel.trust - 2 * magnitude);
        break;
      case 'neutral':
        rel.strength = Math.min(100, rel.strength + 0.5 * magnitude);
        break;
    }

    rel.lastInteractionAt = now;
    rel.updatedAt = now;
    rel.type = this.inferType(rel.strength, rel.trust);

    const countKey = `${fromId}:${toId}`;
    this.interactionCounts.set(countKey, (this.interactionCounts.get(countKey) ?? 0) + 1);

    this.cache.set(`${fromId}:${toId}`, rel);
    this.log.debug({ fromId, toId, type, strength: rel.strength, trust: rel.trust }, 'Interaction recorded');
  }

  /**
   * Get all relationships for a character.
   */
  getRelationships(characterId: string): CharacterRelationship[] {
    const results: CharacterRelationship[] = [];
    for (const rel of this.cache.values()) {
      if (rel.fromId === characterId || rel.toId === characterId) {
        results.push(rel);
      }
    }
    return results;
  }

  /**
   * Get relationship prompt text for context injection.
   */
  getRelationshipPrompt(characterId: string): string | null {
    const rels = this.getRelationships(characterId)
      .filter(r => r.fromId === characterId && r.type !== 'neutral')
      .sort((a, b) => b.strength - a.strength);

    if (rels.length === 0) return null;

    const lines = rels.slice(0, 5).map(r => {
      const strength = r.strength > 70 ? 'strong' : r.strength > 40 ? 'moderate' : 'weak';
      return `- ${r.toId}: ${strength} ${r.type} (trust: ${Math.round(r.trust)})`;
    });

    return `Relationships:\n${lines.join('\n')}`;
  }

  /**
   * Apply decay to all relationships (called on slow tick).
   */
  decayAll(decayAmount: number = 0.1): void {
    for (const rel of this.cache.values()) {
      // Deep bonds: no decay
      if (rel.strength >= 90) continue;

      const key = `${rel.fromId}:${rel.toId}`;
      const interactions = this.interactionCounts.get(key) ?? 0;

      let effective = decayAmount;
      if (interactions < 3) {
        effective = 0.3;                          // new acquaintances fade fast
      } else if (rel.strength >= 70 || rel.trust >= 60) {
        effective = 0.05;                         // established bonds persist
      }

      if (rel.strength > 50) {
        rel.strength = Math.max(50, rel.strength - effective);
      } else if (rel.strength < 50) {
        rel.strength = Math.min(50, rel.strength + effective);
      }
      rel.type = this.inferType(rel.strength, rel.trust);
    }
  }

  /**
   * Remove a specific relationship.
   */
  remove(fromId: string, toId: string): void {
    this.cache.delete(`${fromId}:${toId}`);
  }

  /**
   * Clear all relationships involving a character.
   */
  clearCharacter(characterId: string): void {
    for (const [key, rel] of this.cache) {
      if (rel.fromId === characterId || rel.toId === characterId) {
        this.cache.delete(key);
      }
    }
  }

  saveState(repo: StateRepository): void {
    const data: Array<{
      fromId: string; toId: string; type: string; strength: number;
      trust: number; notes: string; lastInteractionAt: number; updatedAt: number;
    }> = [];
    for (const rel of this.cache.values()) {
      const countKey = `${rel.fromId}:${rel.toId}`;
      const interactions = this.interactionCounts.get(countKey) ?? 0;
      // Encode interaction count in notes (hidden from prompt — getRelationshipPrompt never reads notes)
      const notes = interactions > 0 ? `${rel.notes}\n__ix:${interactions}` : rel.notes;
      data.push({
        fromId: rel.fromId,
        toId: rel.toId,
        type: rel.type,
        strength: rel.strength,
        trust: rel.trust,
        notes,
        lastInteractionAt: rel.lastInteractionAt,
        updatedAt: rel.updatedAt,
      });
    }
    repo.clearRelationships();
    if (data.length > 0) repo.saveRelationships(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllRelationships();
    this.cache.clear();
    this.interactionCounts.clear();
    for (const r of rows) {
      const key = `${r.fromId}:${r.toId}`;
      let notes = r.notes;
      const match = notes.match(/\n__ix:(\d+)$/);
      if (match) {
        this.interactionCounts.set(key, parseInt(match[1], 10));
        notes = notes.replace(/\n__ix:\d+$/, '');
      }
      this.cache.set(key, {
        fromId: r.fromId,
        toId: r.toId,
        type: r.type as RelationshipType,
        strength: r.strength,
        trust: r.trust,
        notes,
        lastInteractionAt: r.lastInteractionAt,
        updatedAt: r.updatedAt,
      });
    }
    this.log.debug({ count: rows.length }, 'Relationships loaded from DB');
  }

  private inferType(strength: number, trust: number): RelationshipType {
    if (strength >= 80 && trust >= 70) return 'friend';
    if (strength >= 70 && trust >= 60) return 'ally';
    if (strength < 20 && trust < 30) return 'enemy';
    if (strength < 30) return 'rival';
    return 'neutral';
  }
}
