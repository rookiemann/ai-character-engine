import { eq, and, desc, gte, lt, sql } from 'drizzle-orm';
import { episodicMemories, workingMemory, characterSummaries } from '../schema';
import type { DB } from '../database';
import type { MemoryRecord, WorkingMemoryEntry, CharacterSummaryRecord } from '../../core/types';
import crypto from 'crypto';

export class MemoryRepository {
  constructor(private db: DB) {}

  // --- Episodic Memories ---

  createEpisodic(memory: Omit<MemoryRecord, 'id'>): MemoryRecord {
    const id = crypto.randomUUID();
    const record: MemoryRecord = { id, ...memory };

    this.db.insert(episodicMemories).values({
      id,
      characterId: record.characterId,
      playerId: record.playerId,
      type: record.type,
      content: record.content,
      summary: record.summary,
      importance: record.importance,
      currentImportance: record.currentImportance,
      isDeep: record.isDeep,
      isPermanent: record.isPermanent,
      tags: JSON.stringify(record.tags),
      eventType: record.eventType ?? null,
      decayRate: record.decayRate,
      createdAt: record.createdAt,
      lastAccessedAt: record.lastAccessedAt,
    }).run();

    return record;
  }

  getEpisodicByCharacter(characterId: string, playerId: string, limit: number = 10): MemoryRecord[] {
    const rows = this.db.select()
      .from(episodicMemories)
      .where(and(
        eq(episodicMemories.characterId, characterId),
        eq(episodicMemories.playerId, playerId),
      ))
      .orderBy(desc(episodicMemories.currentImportance))
      .limit(limit)
      .all();

    return rows.map(r => this.rowToMemory(r));
  }

  getEpisodicByTags(characterId: string, playerId: string, tags: string[], limit: number = 5): MemoryRecord[] {
    // SQLite JSON search - check if any tag matches
    const rows = this.db.select()
      .from(episodicMemories)
      .where(and(
        eq(episodicMemories.characterId, characterId),
        eq(episodicMemories.playerId, playerId),
      ))
      .orderBy(desc(episodicMemories.currentImportance))
      .all();

    // Filter by tags in application layer (more flexible than SQL JSON ops)
    return rows
      .filter(r => {
        const memTags = JSON.parse(r.tags) as string[];
        return tags.some(t => memTags.includes(t));
      })
      .slice(0, limit)
      .map(r => this.rowToMemory(r));
  }

  getEpisodicByEventType(characterId: string, playerId: string, eventType: string, limit: number = 5): MemoryRecord[] {
    const rows = this.db.select()
      .from(episodicMemories)
      .where(and(
        eq(episodicMemories.characterId, characterId),
        eq(episodicMemories.playerId, playerId),
        eq(episodicMemories.eventType, eventType),
      ))
      .orderBy(desc(episodicMemories.currentImportance))
      .limit(limit)
      .all();

    return rows.map(r => this.rowToMemory(r));
  }

  getRecentEpisodic(characterId: string, playerId: string, limit: number = 5): MemoryRecord[] {
    const rows = this.db.select()
      .from(episodicMemories)
      .where(and(
        eq(episodicMemories.characterId, characterId),
        eq(episodicMemories.playerId, playerId),
      ))
      .orderBy(desc(episodicMemories.createdAt))
      .limit(limit)
      .all();

    return rows.map(r => this.rowToMemory(r));
  }

  applyDecay(decayAmount: number): number {
    // Batch decay: reduce currentImportance by decayAmount * decayRate
    // Skip permanent (trauma) memories — they never decay
    const result = this.db.run(sql`
      UPDATE episodic_memories
      SET current_importance = current_importance - (${decayAmount} * decay_rate)
      WHERE current_importance > 0 AND is_permanent = 0
    `);
    return result.changes;
  }

  pruneBelow(threshold: number): number {
    // Never prune permanent (trauma) memories
    const result = this.db.run(sql`
      DELETE FROM episodic_memories
      WHERE current_importance < ${threshold} AND is_permanent = 0
    `);
    return result.changes;
  }

  touchMemory(id: string): void {
    this.db.update(episodicMemories)
      .set({ lastAccessedAt: Date.now() })
      .where(eq(episodicMemories.id, id))
      .run();
  }

  updateEpisodicImportance(id: string, importance: number): void {
    this.db.update(episodicMemories)
      .set({ importance, currentImportance: importance })
      .where(eq(episodicMemories.id, id))
      .run();
  }

  // --- Working Memory ---

  addWorkingMemory(entry: Omit<WorkingMemoryEntry, 'id'>): WorkingMemoryEntry {
    const id = crypto.randomUUID();
    const record: WorkingMemoryEntry = { id, ...entry };

    this.db.insert(workingMemory).values({
      id,
      characterId: record.characterId,
      playerId: record.playerId,
      role: record.role,
      content: record.content,
      turnIndex: record.turnIndex,
      createdAt: record.createdAt,
    }).run();

    return record;
  }

  getWorkingMemory(characterId: string, playerId: string, limit: number = 5): WorkingMemoryEntry[] {
    const rows = this.db.select()
      .from(workingMemory)
      .where(and(
        eq(workingMemory.characterId, characterId),
        eq(workingMemory.playerId, playerId),
      ))
      .orderBy(desc(workingMemory.turnIndex))
      .limit(limit)
      .all();

    return rows.reverse().map(r => ({
      ...r,
      role: r.role as WorkingMemoryEntry['role'],
    })); // Oldest first for conversation order
  }

  trimWorkingMemory(characterId: string, playerId: string, keepCount: number): number {
    // Get all entries sorted by turn, delete everything except the last keepCount
    const all = this.db.select({ id: workingMemory.id, turnIndex: workingMemory.turnIndex })
      .from(workingMemory)
      .where(and(
        eq(workingMemory.characterId, characterId),
        eq(workingMemory.playerId, playerId),
      ))
      .orderBy(desc(workingMemory.turnIndex))
      .all();

    if (all.length <= keepCount) return 0;

    const toDelete = all.slice(keepCount);
    let deleted = 0;
    for (const entry of toDelete) {
      this.db.delete(workingMemory).where(eq(workingMemory.id, entry.id)).run();
      deleted++;
    }
    return deleted;
  }

  clearWorkingMemory(characterId: string, playerId: string): void {
    this.db.delete(workingMemory)
      .where(and(
        eq(workingMemory.characterId, characterId),
        eq(workingMemory.playerId, playerId),
      ))
      .run();
  }

  // --- Character Summaries ---

  upsertSummary(summary: Omit<CharacterSummaryRecord, 'id'>): CharacterSummaryRecord {
    const id = `${summary.characterId}:${summary.playerId}`;
    const record: CharacterSummaryRecord = { id, ...summary };

    // Try to get existing
    const existing = this.db.select()
      .from(characterSummaries)
      .where(eq(characterSummaries.id, id))
      .get();

    if (existing) {
      this.db.update(characterSummaries)
        .set({
          summary: record.summary,
          relationshipNotes: record.relationshipNotes,
          keyFacts: JSON.stringify(record.keyFacts),
          version: record.version,
          generatedAt: record.generatedAt,
        })
        .where(eq(characterSummaries.id, id))
        .run();
    } else {
      this.db.insert(characterSummaries).values({
        id,
        characterId: record.characterId,
        playerId: record.playerId,
        summary: record.summary,
        relationshipNotes: record.relationshipNotes,
        keyFacts: JSON.stringify(record.keyFacts),
        version: record.version,
        generatedAt: record.generatedAt,
      }).run();
    }

    return record;
  }

  getSummary(characterId: string, playerId: string): CharacterSummaryRecord | null {
    const id = `${characterId}:${playerId}`;
    const row = this.db.select()
      .from(characterSummaries)
      .where(eq(characterSummaries.id, id))
      .get();

    if (!row) return null;

    return {
      id: row.id,
      characterId: row.characterId,
      playerId: row.playerId,
      summary: row.summary,
      relationshipNotes: row.relationshipNotes,
      keyFacts: JSON.parse(row.keyFacts) as string[],
      version: row.version,
      generatedAt: row.generatedAt,
    };
  }

  private rowToMemory(row: typeof episodicMemories.$inferSelect): MemoryRecord {
    return {
      id: row.id,
      characterId: row.characterId,
      playerId: row.playerId,
      type: row.type as MemoryRecord['type'],
      content: row.content,
      summary: row.summary,
      importance: row.importance,
      currentImportance: row.currentImportance,
      isDeep: row.isDeep,
      isPermanent: row.isPermanent,
      tags: JSON.parse(row.tags) as string[],
      eventType: row.eventType ?? undefined,
      decayRate: row.decayRate,
      createdAt: row.createdAt,
      lastAccessedAt: row.lastAccessedAt,
    };
  }
}
