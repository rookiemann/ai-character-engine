import { eq } from 'drizzle-orm';
import { characters } from '../schema';
import type { DB } from '../database';
import type { CharacterDefinition, CharacterState, CharacterIdentity } from '../../core/types';
import crypto from 'crypto';

export class CharacterRepository {
  constructor(private db: DB) {}

  create(def: CharacterDefinition): CharacterState {
    const now = Date.now();
    const state: CharacterState = {
      id: def.id,
      name: def.name,
      archetype: def.archetype,
      identity: def.identity,
      activityTier: 'dormant',
      closeness: def.initialCloseness ?? 0,
      highWaterMark: def.initialCloseness ?? 0,
      metadata: def.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(characters).values({
      id: state.id,
      name: state.name,
      archetype: state.archetype,
      identity: JSON.stringify(state.identity),
      activityTier: state.activityTier,
      closeness: state.closeness,
      highWaterMark: state.highWaterMark,
      metadata: JSON.stringify(state.metadata),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    }).run();

    return state;
  }

  getById(id: string): CharacterState | null {
    const row = this.db.select().from(characters).where(eq(characters.id, id)).get();
    if (!row) return null;
    return this.rowToState(row);
  }

  getAll(): CharacterState[] {
    const rows = this.db.select().from(characters).all();
    return rows.map(r => this.rowToState(r));
  }

  getByTier(tier: string): CharacterState[] {
    const rows = this.db.select().from(characters).where(eq(characters.activityTier, tier)).all();
    return rows.map(r => this.rowToState(r));
  }

  update(id: string, updates: Partial<Pick<CharacterState, 'activityTier' | 'closeness' | 'highWaterMark' | 'metadata' | 'identity'>>): void {
    const values: Record<string, unknown> = { updatedAt: Date.now() };
    if (updates.activityTier !== undefined) values.activityTier = updates.activityTier;
    if (updates.closeness !== undefined) values.closeness = updates.closeness;
    if (updates.highWaterMark !== undefined) values.highWaterMark = updates.highWaterMark;
    if (updates.metadata !== undefined) values.metadata = JSON.stringify(updates.metadata);
    if (updates.identity !== undefined) values.identity = JSON.stringify(updates.identity);

    this.db.update(characters).set(values).where(eq(characters.id, id)).run();
  }

  delete(id: string): void {
    this.db.delete(characters).where(eq(characters.id, id)).run();
  }

  private rowToState(row: typeof characters.$inferSelect): CharacterState {
    return {
      id: row.id,
      name: row.name,
      archetype: row.archetype,
      identity: JSON.parse(row.identity) as CharacterIdentity,
      activityTier: row.activityTier as CharacterState['activityTier'],
      closeness: row.closeness,
      highWaterMark: row.highWaterMark,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
