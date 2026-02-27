import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Engine } from '../../src/core/Engine';
import { HttpServer } from '../../src/api/HttpServer';
import type { GamePlugin, ArchetypeDefinition, CharacterDefinition, ToolDefinition, GameState, CharacterProprioception } from '../../src/core/types';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';
import { existsSync, unlinkSync } from 'fs';

const DB_PATH = './data/test-api.db';
const PORT = 9876;

function createTestPlugin(): GamePlugin {
  return {
    id: 'test-api',
    name: 'Test API Plugin',
    getArchetypes(): ArchetypeDefinition[] {
      return [{ id: 'npc', name: 'NPC', description: 'Generic NPC', defaultIdentity: {
        personality: 'Helpful', backstory: 'A local', goals: ['Exist'], traits: ['calm'],
      }}];
    },
    getInitialCharacters(): CharacterDefinition[] {
      return [{
        id: 'char-api-0', name: 'TestChar', archetype: 'npc', initialCloseness: 50,
        identity: { personality: 'Friendly', backstory: 'For testing', goals: ['Test'], traits: ['calm'] },
      }];
    },
    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [{
        definition: { name: 'wave', description: 'Wave at someone', parameters: [
          { name: 'target', type: 'string', description: 'Who', required: true },
        ]},
        executor: (args) => ({ success: true, result: `Waved at ${args.target}` }),
      }];
    },
    getGameState(): GameState {
      return { worldTime: 100, location: 'test', nearbyEntities: [], recentEvents: [] };
    },
    getProprioception(): CharacterProprioception {
      return { currentAction: 'idle', location: 'test', inventory: [], status: ['ok'], energy: 1 };
    },
    getWorldRules() { return 'Test world'; },
    getEventTypes() { return ['test']; },
  };
}

async function fetchApi(path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

describe('HTTP API', () => {
  let engine: Engine;
  let server: HttpServer;

  beforeAll(async () => {
    // Clean up
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
      try { unlinkSync(f); } catch {}
    }

    engine = new Engine({
      database: { path: DB_PATH },
      inference: { type: 'lmstudio', baseUrl: 'http://localhost:1234/v1', models: { heavy: 'x', mid: 'x', light: 'x' } },
      tick: { fastTickMs: 60000, slowTickMs: 120000 },
      logging: { level: 'error', pretty: false },
    });

    await engine.loadPlugin(createTestPlugin());
    server = new HttpServer(engine, { port: PORT });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await engine.stop();
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
      try { unlinkSync(f); } catch {}
    }
  });

  it('GET /api/health returns health status', async () => {
    const { status, data } = await fetchApi('/api/health');
    expect(data).toHaveProperty('database');
    expect(data).toHaveProperty('inference');
  });

  it('GET /api/stats returns engine stats', async () => {
    const { status, data } = await fetchApi('/api/stats');
    expect(status).toBe(200);
    expect(data).toHaveProperty('characters');
    expect(data).toHaveProperty('inference');
    expect(data).toHaveProperty('scheduler');
  });

  it('GET /api/characters lists characters', async () => {
    const { status, data } = await fetchApi('/api/characters');
    expect(status).toBe(200);
    expect(data.characters).toBeInstanceOf(Array);
    expect(data.characters.length).toBeGreaterThanOrEqual(1);
    expect(data.characters[0]).toHaveProperty('name', 'TestChar');
  });

  it('GET /api/characters/:id returns single character', async () => {
    const { status, data } = await fetchApi('/api/characters/char-api-0');
    expect(status).toBe(200);
    expect(data.character.name).toBe('TestChar');
    expect(data).toHaveProperty('proximity');
    expect(data).toHaveProperty('emotions');
    expect(data).toHaveProperty('mood');
  });

  it('GET /api/characters/:id returns 404 for missing', async () => {
    const { status } = await fetchApi('/api/characters/nonexistent');
    expect(status).toBe(404);
  });

  it('POST /api/characters registers new character', async () => {
    const { status, data } = await fetchApi('/api/characters', {
      method: 'POST',
      body: {
        id: 'char-api-1', name: 'NewChar', archetype: 'npc',
        identity: { personality: 'Bold', backstory: 'New', goals: ['Explore'], traits: ['brave'] },
      },
    });
    expect(status).toBe(201);
    expect(data.character.name).toBe('NewChar');

    // Verify it shows up in list
    const list = await fetchApi('/api/characters');
    expect(list.data.characters.length).toBe(2);
  });

  it('GET /api/characters/:id/introspection returns full introspection', async () => {
    const { status, data } = await fetchApi('/api/characters/char-api-0/introspection');
    expect(status).toBe(200);
    expect(data).toHaveProperty('character');
    expect(data).toHaveProperty('emotions');
    expect(data).toHaveProperty('goals');
    expect(data).toHaveProperty('relationships');
    expect(data).toHaveProperty('groups');
  });

  it('GET /api/proximity/:characterId returns proximity', async () => {
    const { status, data } = await fetchApi('/api/proximity/char-api-0');
    expect(status).toBe(200);
    expect(data).toHaveProperty('closeness');
    expect(data.closeness).toBe(50);
  });

  it('POST /api/proximity/:characterId/boost boosts closeness', async () => {
    const { status, data } = await fetchApi('/api/proximity/char-api-0/boost', {
      method: 'POST',
      body: { amount: 10 },
    });
    expect(status).toBe(200);
    expect(data.closeness).toBeGreaterThan(50);
  });

  it('POST /api/emotions/:characterId applies emotion', async () => {
    const { status, data } = await fetchApi('/api/emotions/char-api-0', {
      method: 'POST',
      body: { emotion: 'joy', intensity: 0.8 },
    });
    expect(status).toBe(200);
    expect(data.emotions.active.length).toBeGreaterThan(0);
  });

  it('POST /api/relationships sets relationship', async () => {
    const { status, data } = await fetchApi('/api/relationships', {
      method: 'POST',
      body: { fromId: 'char-api-0', toId: 'char-api-1', type: 'friend', strength: 80 },
    });
    expect(status).toBe(200);
    expect(data.relationship.type).toBe('friend');
    expect(data.relationship.strength).toBe(80);
  });

  it('POST /api/goals/:characterId adds goal', async () => {
    const { status, data } = await fetchApi('/api/goals/char-api-0', {
      method: 'POST',
      body: { description: 'Find treasure', priority: 7 },
    });
    expect(status).toBe(201);
    expect(data.goal.description).toBe('Find treasure');
  });

  it('POST /api/world-facts sets and GET retrieves', async () => {
    const setRes = await fetchApi('/api/world-facts', {
      method: 'POST',
      body: { key: 'weather', value: 'sunny', category: 'global', source: 'test' },
    });
    expect(setRes.status).toBe(200);

    const getRes = await fetchApi('/api/world-facts/weather');
    expect(getRes.status).toBe(200);
    expect(getRes.data.value).toBe('sunny');
  });

  it('POST /api/events injects event', async () => {
    const { status, data } = await fetchApi('/api/events', {
      method: 'POST',
      body: { event: { type: 'test', source: 'api', importance: 3, timestamp: Date.now() } },
    });
    expect(status).toBe(200);
    expect(data.injected).toBe(true);
  });

  it('GET /api/decisions/count returns count', async () => {
    const { status, data } = await fetchApi('/api/decisions/count');
    expect(status).toBe(200);
    expect(typeof data.count).toBe('number');
  });

  it('POST /api/state/save persists state', async () => {
    const { status, data } = await fetchApi('/api/state/save', { method: 'POST' });
    expect(status).toBe(200);
    expect(data.saved).toBe(true);
  });

  it('POST /api/state/snapshot creates snapshot', async () => {
    const { status, data } = await fetchApi('/api/state/snapshot', {
      method: 'POST',
      body: { name: 'test-snap' },
    });
    expect(status).toBe(201);
    expect(data.snapshotId).toBeTruthy();
  });

  it('GET /api/state/snapshots lists snapshots', async () => {
    const { status, data } = await fetchApi('/api/state/snapshots');
    expect(status).toBe(200);
    expect(data.snapshots.length).toBeGreaterThan(0);
  });

  it('POST /api/state/export exports state', async () => {
    const { status, data } = await fetchApi('/api/state/export', { method: 'POST' });
    expect(status).toBe(200);
    expect(data).toHaveProperty('exportedAt');
  });

  it('returns 404 for unknown routes', async () => {
    const { status } = await fetchApi('/api/nonexistent');
    expect(status).toBe(404);
  });

  it('handles CORS preflight', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/characters`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('DELETE /api/characters/:id removes character', async () => {
    const { status, data } = await fetchApi('/api/characters/char-api-1', { method: 'DELETE' });
    expect(status).toBe(200);
    expect(data.removed).toBe('char-api-1');

    const list = await fetchApi('/api/characters');
    expect(list.data.characters.length).toBe(1);
  });
});
