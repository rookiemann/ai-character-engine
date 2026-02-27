/**
 * Example: HTTP API Server
 *
 * Starts the AI Character Engine with an HTTP API layer.
 * Any game can integrate via REST calls — no TypeScript/Node dependency needed.
 *
 * Usage:
 *   npx tsx examples/api-server/index.ts
 *
 * Then:
 *   curl http://localhost:3000/api/health
 *   curl http://localhost:3000/api/characters
 *   curl -X POST http://localhost:3000/api/chat/char-0 -H 'Content-Type: application/json' -d '{"message":"Hello!"}'
 */

import { Engine, HttpServer, loadConfigFile } from '../../src/index';
import type { GamePlugin, ArchetypeDefinition, CharacterDefinition, ToolDefinition, GameState, CharacterProprioception, EngineConfig } from '../../src/index';
import type { ToolExecutorFn } from '../../src/tools/ToolRegistry';

// ── Minimal Game Plugin ──────────────────────────────────────

function createDemoPlugin(): GamePlugin {
  return {
    id: 'demo',
    name: 'Demo World',

    getArchetypes(): ArchetypeDefinition[] {
      return [
        { id: 'villager', name: 'Villager', description: 'A common villager', defaultIdentity: {
          personality: 'Friendly and helpful', backstory: 'Lives in the village', goals: ['Help others'], traits: ['kind'],
        }},
        { id: 'guard', name: 'Guard', description: 'Village guard', defaultIdentity: {
          personality: 'Vigilant and duty-bound', backstory: 'Protects the village', goals: ['Keep peace'], traits: ['brave'],
        }},
      ];
    },

    getInitialCharacters(): CharacterDefinition[] {
      return [
        {
          id: 'char-0', name: 'Elena', archetype: 'villager', initialCloseness: 65,
          identity: { personality: 'Warm and curious', backstory: 'The village healer', goals: ['Help the sick'], traits: ['kind', 'wise'], speechStyle: 'Gentle and caring' },
        },
        {
          id: 'char-1', name: 'Marcus', archetype: 'guard', initialCloseness: 45,
          identity: { personality: 'Stern but fair', backstory: 'Captain of the guard', goals: ['Protect the village'], traits: ['brave', 'loyal'], speechStyle: 'Direct and formal' },
        },
      ];
    },

    getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }> {
      return [
        {
          definition: { name: 'greet', description: 'Greet someone', parameters: [
            { name: 'target', type: 'string', description: 'Who to greet', required: true },
          ]},
          executor: (args) => ({ success: true, result: `Greeted ${args.target}` }),
        },
        {
          definition: { name: 'patrol', description: 'Patrol an area', parameters: [
            { name: 'area', type: 'string', description: 'Area to patrol', required: true },
          ]},
          executor: (args) => ({ success: true, result: `Patrolling ${args.area}` }),
        },
      ];
    },

    getGameState(): GameState {
      return { worldTime: Date.now(), location: 'Village', nearbyEntities: ['Elena', 'Marcus'], recentEvents: [] };
    },

    getProprioception(characterId: string): CharacterProprioception {
      return { currentAction: 'idle', location: 'village_square', inventory: [], status: ['healthy'], energy: 0.9 };
    },

    getWorldRules(): string {
      return 'A peaceful village. Characters interact naturally. Be concise.';
    },

    getEventTypes(): string[] {
      return ['greeting', 'patrol', 'trade'];
    },
  };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const fs = await import('fs');
  try { fs.mkdirSync('./data', { recursive: true }); } catch {}

  // Try loading config from file first, fall back to inline defaults
  let config: EngineConfig;
  try {
    config = loadConfigFile();
    console.log('Loaded config from engine.config.json');
  } catch {
    console.log('No engine.config.json found, using inline defaults');
    config = {
      database: { path: './data/api-demo.db' },
      inference: {
        type: 'ollama',
        models: {
          heavy: 'qwen2.5:7b',
          mid: 'qwen2.5:7b',
          light: 'qwen2.5:1.5b',
        },
        maxConcurrency: 4,
        timeoutMs: 30000,
      },
      tick: { fastTickMs: 5000, slowTickMs: 30000, batchSize: 4 },
      logging: { level: 'info', pretty: true },
    };
  }

  const engine = new Engine(config);

  await engine.loadPlugin(createDemoPlugin());

  // Set up some world state
  engine.setWorldFact('time_of_day', 'morning', 'global', 'system');
  engine.setRelationship('char-0', 'char-1', { type: 'friend', strength: 70 });

  // Start the HTTP API
  const server = new HttpServer(engine, { port: 3000 });
  await server.start();

  // Start the engine tick loops
  engine.start();

  console.log('\n  AI Character Engine API running at http://localhost:3000\n');
  console.log('  Endpoints:');
  console.log('    GET  /api/health                     - Health check');
  console.log('    GET  /api/stats                      - Engine stats');
  console.log('    GET  /api/characters                 - List characters');
  console.log('    GET  /api/characters/:id             - Get character details');
  console.log('    GET  /api/characters/:id/introspection - Full introspection');
  console.log('    POST /api/characters                 - Register character');
  console.log('    POST /api/chat/:characterId          - Chat with character');
  console.log('    POST /api/events                     - Inject game event');
  console.log('    GET  /api/proximity/:characterId     - Get closeness');
  console.log('    POST /api/proximity/:characterId/boost - Boost closeness');
  console.log('    POST /api/emotions/:characterId      - Apply emotion');
  console.log('    POST /api/relationships              - Set relationship');
  console.log('    POST /api/goals/:characterId         - Add goal');
  console.log('    POST /api/world-facts                - Set world fact');
  console.log('    GET  /api/world-facts/:key           - Get world fact');
  console.log('    POST /api/groups                     - Create group');
  console.log('    POST /api/decisions/query            - Query decisions');
  console.log('    GET  /api/decisions/count             - Count decisions');
  console.log('    POST /api/state/save                 - Persist state');
  console.log('    POST /api/state/snapshot             - Save snapshot');
  console.log('    GET  /api/state/snapshots            - List snapshots');
  console.log('    POST /api/state/export               - Export state');
  console.log('    POST /api/state/import               - Import state');
  console.log('    POST /api/config                     - Update config');
  console.log('\n  Press Ctrl+C to stop\n');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n  Shutting down...');
    await engine.stop();
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);
