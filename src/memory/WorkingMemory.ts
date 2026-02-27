import type { WorkingMemoryEntry } from '../core/types';
import { MemoryRepository } from '../db/repositories/MemoryRepository';
import { getLogger } from '../core/logger';

/**
 * Tier 1: Working Memory - Ring buffer of last N exchanges.
 * Kept in-memory for fast access, backed by SQLite for persistence.
 */
export class WorkingMemory {
  private buffers = new Map<string, WorkingMemoryEntry[]>(); // key: characterId:playerId
  private turnCounters = new Map<string, number>();
  private log = getLogger('working-memory');

  constructor(
    private repo: MemoryRepository,
    private maxSize: number = 5,
  ) {}

  private key(characterId: string, playerId: string): string {
    return `${characterId}:${playerId}`;
  }

  /**
   * Load working memory from DB into in-memory buffer.
   */
  load(characterId: string, playerId: string): WorkingMemoryEntry[] {
    const k = this.key(characterId, playerId);
    if (this.buffers.has(k)) {
      return this.buffers.get(k)!;
    }

    const entries = this.repo.getWorkingMemory(characterId, playerId, this.maxSize);
    this.buffers.set(k, entries);

    const maxTurn = entries.reduce((max, e) => Math.max(max, e.turnIndex), 0);
    this.turnCounters.set(k, maxTurn);

    return entries;
  }

  /**
   * Add an exchange to working memory. Evicts oldest if over maxSize.
   */
  add(characterId: string, playerId: string, role: 'user' | 'assistant' | 'system', content: string): WorkingMemoryEntry {
    const k = this.key(characterId, playerId);
    this.load(characterId, playerId); // Ensure loaded

    const turnIndex = (this.turnCounters.get(k) ?? 0) + 1;
    this.turnCounters.set(k, turnIndex);

    const entry = this.repo.addWorkingMemory({
      characterId,
      playerId,
      role,
      content,
      turnIndex,
      createdAt: Date.now(),
    });

    const buffer = this.buffers.get(k)!;
    buffer.push(entry);

    // Trim ring buffer
    if (buffer.length > this.maxSize) {
      buffer.splice(0, buffer.length - this.maxSize);
      this.repo.trimWorkingMemory(characterId, playerId, this.maxSize);
    }

    return entry;
  }

  /**
   * Get current working memory for a character.
   */
  get(characterId: string, playerId: string): WorkingMemoryEntry[] {
    return this.load(characterId, playerId);
  }

  /**
   * Clear working memory for a character.
   */
  clear(characterId: string, playerId: string): void {
    const k = this.key(characterId, playerId);
    this.buffers.delete(k);
    this.turnCounters.delete(k);
    this.repo.clearWorkingMemory(characterId, playerId);
  }

  /**
   * Evict from in-memory cache (DB remains).
   */
  evict(characterId: string, playerId: string): void {
    const k = this.key(characterId, playerId);
    this.buffers.delete(k);
    this.turnCounters.delete(k);
  }
}
