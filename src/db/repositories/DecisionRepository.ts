import type { DB } from '../database';
import { getRawDatabase } from '../database';
import type { DecisionLogEntry } from '../../core/types';
import { getLogger } from '../../core/logger';

export interface DecisionQueryFilters {
  characterId?: string;
  playerId?: string;
  triggerType?: string;
  actionType?: string;
  fromTime?: number;
  toTime?: number;
  limit?: number;
  offset?: number;
}

/**
 * DecisionRepository — activates the existing decision_log table
 * for querying and recording decision audit trails.
 */
export class DecisionRepository {
  private log = getLogger('decision-repo');

  constructor(private db: DB) {}

  private raw() {
    return getRawDatabase();
  }

  record(entry: DecisionLogEntry): void {
    const raw = this.raw();
    raw.prepare(`
      INSERT INTO decision_log (id, character_id, player_id, trigger_type, trigger_event, context_tokens, response_tokens, inference_tier, action, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.characterId,
      entry.playerId,
      entry.triggerType,
      entry.triggerEvent ?? null,
      entry.contextTokens,
      entry.responseTokens,
      entry.inferenceTier,
      entry.action,
      entry.durationMs,
      entry.createdAt,
    );
  }

  query(filters: DecisionQueryFilters = {}): DecisionLogEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.characterId) {
      conditions.push('character_id = ?');
      params.push(filters.characterId);
    }
    if (filters.playerId) {
      conditions.push('player_id = ?');
      params.push(filters.playerId);
    }
    if (filters.triggerType) {
      conditions.push('trigger_type = ?');
      params.push(filters.triggerType);
    }
    if (filters.actionType) {
      conditions.push("json_extract(action, '$.type') = ? OR json_extract(action, '$.toolName') = ?");
      params.push(filters.actionType, filters.actionType);
    }
    if (filters.fromTime !== undefined) {
      conditions.push('created_at >= ?');
      params.push(filters.fromTime);
    }
    if (filters.toTime !== undefined) {
      conditions.push('created_at <= ?');
      params.push(filters.toTime);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const sql = `SELECT * FROM decision_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const raw = this.raw();
    const rows = raw.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      characterId: r.character_id,
      playerId: r.player_id,
      triggerType: r.trigger_type,
      triggerEvent: r.trigger_event ?? undefined,
      contextTokens: r.context_tokens,
      responseTokens: r.response_tokens,
      inferenceTier: r.inference_tier,
      action: r.action,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }));
  }

  count(filters: DecisionQueryFilters = {}): number {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.characterId) {
      conditions.push('character_id = ?');
      params.push(filters.characterId);
    }
    if (filters.playerId) {
      conditions.push('player_id = ?');
      params.push(filters.playerId);
    }
    if (filters.triggerType) {
      conditions.push('trigger_type = ?');
      params.push(filters.triggerType);
    }
    if (filters.fromTime !== undefined) {
      conditions.push('created_at >= ?');
      params.push(filters.fromTime);
    }
    if (filters.toTime !== undefined) {
      conditions.push('created_at <= ?');
      params.push(filters.toTime);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) as count FROM decision_log ${where}`;

    const raw = this.raw();
    const row = raw.prepare(sql).get(...params) as any;
    return row.count;
  }
}
