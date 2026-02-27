import type { WorldFact, Persistable } from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { getLogger } from '../core/logger';

/**
 * Expansion 8: Persistent World State
 *
 * A shared knowledge base that all characters can query.
 * Tracks world facts with source attribution and confidence.
 */
export class WorldStateManager implements Persistable {
  private facts = new Map<string, WorldFact>();
  private categories = new Map<string, Set<string>>(); // category → keys
  private log = getLogger('world-state');

  /**
   * Set a world fact.
   */
  set(key: string, value: unknown, category: string, source: string, confidence: number = 1): void {
    const fact: WorldFact = {
      key,
      value,
      category,
      source,
      confidence: Math.max(0, Math.min(1, confidence)),
      updatedAt: Date.now(),
    };

    this.facts.set(key, fact);

    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category)!.add(key);

    this.log.debug({ key, category, source }, 'World fact set');
  }

  /**
   * Get a world fact by key.
   */
  get(key: string): WorldFact | undefined {
    return this.facts.get(key);
  }

  /**
   * Get the value of a world fact.
   */
  getValue<T = unknown>(key: string): T | undefined {
    return this.facts.get(key)?.value as T | undefined;
  }

  /**
   * Get all facts in a category.
   */
  getByCategory(category: string): WorldFact[] {
    const keys = this.categories.get(category);
    if (!keys) return [];
    return [...keys].map(k => this.facts.get(k)!).filter(Boolean);
  }

  /**
   * Query facts matching a pattern.
   */
  query(pattern: string): WorldFact[] {
    const regex = new RegExp(pattern, 'i');
    const results: WorldFact[] = [];
    for (const fact of this.facts.values()) {
      if (regex.test(fact.key) || regex.test(String(fact.value))) {
        results.push(fact);
      }
    }
    return results;
  }

  /**
   * Remove a fact.
   */
  remove(key: string): boolean {
    const fact = this.facts.get(key);
    if (!fact) return false;

    this.facts.delete(key);
    this.categories.get(fact.category)?.delete(key);
    return true;
  }

  /**
   * Get all categories.
   */
  getCategories(): string[] {
    return [...this.categories.keys()];
  }

  /**
   * Get world state summary for prompt injection.
   * Returns facts relevant to a character's location or situation.
   */
  getWorldPrompt(location?: string, maxFacts: number = 5): string | null {
    let relevantFacts: WorldFact[];

    if (location) {
      // Prioritize location-relevant facts
      relevantFacts = [
        ...this.getByCategory('location'),
        ...this.query(location),
        ...this.getByCategory('global'),
      ];
    } else {
      relevantFacts = this.getByCategory('global');
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    const unique = relevantFacts.filter(f => {
      if (seen.has(f.key)) return false;
      seen.add(f.key);
      return true;
    });

    if (unique.length === 0) return null;

    const lines = unique.slice(0, maxFacts).map(f =>
      `- ${f.key}: ${JSON.stringify(f.value)}`,
    );

    return `World state:\n${lines.join('\n')}`;
  }

  /**
   * Get all facts (for serialization).
   */
  getAll(): WorldFact[] {
    return [...this.facts.values()];
  }

  /**
   * Load facts from an array (for deserialization).
   */
  loadAll(facts: WorldFact[]): void {
    for (const fact of facts) {
      this.set(fact.key, fact.value, fact.category, fact.source, fact.confidence);
    }
  }

  /**
   * Get count of facts.
   */
  get size(): number {
    return this.facts.size;
  }

  saveState(repo: StateRepository): void {
    const data: Array<{
      key: string; value: string; category: string; source: string;
      confidence: number; updatedAt: number;
    }> = [];
    for (const fact of this.facts.values()) {
      data.push({
        key: fact.key,
        value: JSON.stringify(fact.value),
        category: fact.category,
        source: fact.source,
        confidence: fact.confidence,
        updatedAt: fact.updatedAt,
      });
    }
    repo.clearWorldFacts();
    if (data.length > 0) repo.saveWorldFacts(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllWorldFacts();
    this.facts.clear();
    this.categories.clear();
    for (const r of rows) {
      const value = JSON.parse(r.value);
      this.set(r.key, value, r.category, r.source, r.confidence);
      // Override updatedAt from DB
      const fact = this.facts.get(r.key);
      if (fact) fact.updatedAt = r.updatedAt;
    }
    this.log.debug({ count: rows.length }, 'World facts loaded from DB');
  }
}
