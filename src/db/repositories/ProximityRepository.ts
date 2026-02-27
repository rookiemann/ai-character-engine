import { eq, and, gte, lt } from 'drizzle-orm';
import { proximityScores } from '../schema';
import type { DB } from '../database';
import type { ProximityScore, ActivityTier } from '../../core/types';

export class ProximityRepository {
  constructor(private db: DB) {}

  upsert(score: ProximityScore): void {
    const existing = this.db.select()
      .from(proximityScores)
      .where(and(
        eq(proximityScores.characterId, score.characterId),
        eq(proximityScores.playerId, score.playerId),
      ))
      .get();

    if (existing) {
      this.db.update(proximityScores)
        .set({
          closeness: score.closeness,
          highWaterMark: score.highWaterMark,
          activityTier: score.activityTier,
          lastInteractionAt: score.lastInteractionAt,
          totalInteractions: score.totalInteractions,
          updatedAt: score.updatedAt,
        })
        .where(and(
          eq(proximityScores.characterId, score.characterId),
          eq(proximityScores.playerId, score.playerId),
        ))
        .run();
    } else {
      this.db.insert(proximityScores).values({
        characterId: score.characterId,
        playerId: score.playerId,
        closeness: score.closeness,
        highWaterMark: score.highWaterMark,
        activityTier: score.activityTier,
        lastInteractionAt: score.lastInteractionAt,
        totalInteractions: score.totalInteractions,
        updatedAt: score.updatedAt,
      }).run();
    }
  }

  get(characterId: string, playerId: string): ProximityScore | null {
    const row = this.db.select()
      .from(proximityScores)
      .where(and(
        eq(proximityScores.characterId, characterId),
        eq(proximityScores.playerId, playerId),
      ))
      .get();

    if (!row) return null;
    return this.rowToScore(row);
  }

  getByTier(tier: ActivityTier): ProximityScore[] {
    const rows = this.db.select()
      .from(proximityScores)
      .where(eq(proximityScores.activityTier, tier))
      .all();

    return rows.map(r => this.rowToScore(r));
  }

  getAll(playerId: string): ProximityScore[] {
    const rows = this.db.select()
      .from(proximityScores)
      .where(eq(proximityScores.playerId, playerId))
      .all();

    return rows.map(r => this.rowToScore(r));
  }

  delete(characterId: string, playerId: string): void {
    this.db.delete(proximityScores)
      .where(and(
        eq(proximityScores.characterId, characterId),
        eq(proximityScores.playerId, playerId),
      ))
      .run();
  }

  private rowToScore(row: typeof proximityScores.$inferSelect): ProximityScore {
    return {
      characterId: row.characterId,
      playerId: row.playerId,
      closeness: row.closeness,
      highWaterMark: row.highWaterMark,
      activityTier: row.activityTier as ActivityTier,
      lastInteractionAt: row.lastInteractionAt,
      totalInteractions: row.totalInteractions,
      updatedAt: row.updatedAt,
    };
  }
}
