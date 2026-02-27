import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { Engine } from '../core/Engine';
import { EngineError, ValidationError } from '../core/errors';
import { getLogger } from '../core/logger';

const MAX_BODY_BYTES = 1_048_576; // 1 MB
let requestCounter = 0;

type RouteHandler = (req: ParsedRequest, res: ServerResponse, engine: Engine) => Promise<void>;

interface ParsedRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  requestId: string;
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

/**
 * Lightweight HTTP API server for the AI Character Engine.
 * No external framework dependencies — uses native Node.js http.
 *
 * Security features:
 * - Request body size limits (1MB default)
 * - Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
 * - Proper HTTP status code mapping from EngineError subclasses
 * - Request ID tracking for debugging
 * - Input type validation via requireBody
 *
 * Usage:
 *   const server = new HttpServer(engine, { port: 3000 });
 *   await server.start();
 */
export class HttpServer {
  private server: Server;
  private routes: Route[] = [];
  private log = getLogger('http-server');
  private port: number;
  private host: string;

  constructor(
    private engine: Engine,
    options: { port?: number; host?: string } = {},
  ) {
    this.port = options.port ?? 3000;
    this.host = options.host ?? '0.0.0.0';
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.registerRoutes();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.log.info({ port: this.port, host: this.host }, 'HTTP server started');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.log.info('HTTP server stopped');
        resolve();
      });
    });
  }

  get address(): string {
    return `http://${this.host}:${this.port}`;
  }

  // --- Route registration ---

  private route(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:(\w+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  private registerRoutes(): void {
    // --- Characters ---
    this.route('GET', '/api/characters', handleListCharacters);
    this.route('GET', '/api/characters/:id', handleGetCharacter);
    this.route('POST', '/api/characters', handleRegisterCharacter);
    this.route('DELETE', '/api/characters/:id', handleRemoveCharacter);
    this.route('GET', '/api/characters/:id/introspection', handleIntrospection);

    // --- Chat ---
    this.route('POST', '/api/chat/:characterId', handleChat);

    // --- Events ---
    this.route('POST', '/api/events', handleInjectEvent);

    // --- Proximity ---
    this.route('GET', '/api/proximity/:characterId', handleGetProximity);
    this.route('POST', '/api/proximity/:characterId/boost', handleBoostProximity);

    // --- Decisions ---
    this.route('POST', '/api/decisions/query', handleQueryDecisions);
    this.route('GET', '/api/decisions/count', handleCountDecisions);

    // --- Expansion Systems ---
    this.route('POST', '/api/emotions/:characterId', handleApplyEmotion);
    this.route('POST', '/api/relationships', handleSetRelationship);
    this.route('POST', '/api/goals/:characterId', handleAddGoal);
    this.route('POST', '/api/world-facts', handleSetWorldFact);
    this.route('GET', '/api/world-facts/:key', handleGetWorldFact);
    this.route('POST', '/api/groups', handleCreateGroup);
    this.route('POST', '/api/conversations', handleStartConversation);

    // --- State Management ---
    this.route('POST', '/api/state/save', handlePersistState);
    this.route('POST', '/api/state/snapshot', handleSaveSnapshot);
    this.route('GET', '/api/state/snapshots', handleListSnapshots);
    this.route('POST', '/api/state/export', handleExportState);
    this.route('POST', '/api/state/import', handleImportState);

    // --- Engine ---
    this.route('GET', '/api/stats', handleStats);
    this.route('GET', '/api/health', handleHealth);
    this.route('GET', '/api/metrics', handleMetrics);
    this.route('POST', '/api/config', handleUpdateConfig);

    // --- A/B Experiment ---
    this.route('GET', '/api/experiment', handleGetExperiment);
    this.route('POST', '/api/experiment/variant', handleAddVariant);
    this.route('POST', '/api/experiment/start', handleStartExperiment);
    this.route('POST', '/api/experiment/stop', handleStopExperiment);
  }

  // --- Request handling ---

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now();
    const requestId = `req_${++requestCounter}`;

    // Security headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Request-Id', requestId);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const parsed = await this.parseRequest(req, requestId);
      const route = this.findRoute(parsed.method, parsed.path);

      if (!route) {
        sendJson(res, 404, { error: 'Not found', path: parsed.path, requestId });
        return;
      }

      // Extract path params
      const match = route.pattern.exec(parsed.path);
      if (match) {
        route.paramNames.forEach((name, i) => {
          parsed.params[name] = decodeURIComponent(match[i + 1]);
        });
      }

      await route.handler(parsed, res, this.engine);

      const duration = Date.now() - startTime;
      this.log.debug({
        method: parsed.method,
        path: parsed.path,
        status: res.statusCode,
        durationMs: duration,
        requestId,
      }, 'Request handled');
    } catch (err) {
      const { status, body } = mapErrorToResponse(err, requestId);
      this.log.error({ error: body.error, path: req.url, requestId, status }, 'Request error');
      sendJson(res, status, body);
    }
  }

  private async parseRequest(req: IncomingMessage, requestId: string): Promise<ParsedRequest> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    let body: unknown = undefined;
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await readBody(req);
    }

    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    return {
      method: req.method ?? 'GET',
      path: url.pathname,
      params: {},
      query,
      body,
      requestId,
    };
  }

  private findRoute(method: string, path: string): Route | undefined {
    return this.routes.find(r =>
      r.method === method && r.pattern.test(path),
    );
  }
}

// --- Helper functions ---

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new ValidationError(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw || raw.trim().length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Validate request body: check required fields exist and optionally validate types.
 * `fieldSpecs` can be plain field names or `field:type` pairs.
 * Examples: 'id', 'name', 'amount:number', 'active:boolean', 'tags:array'
 */
function requireBody<T>(body: unknown, ...fieldSpecs: string[]): T {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body required');
  }
  const obj = body as Record<string, unknown>;
  for (const spec of fieldSpecs) {
    const [field, expectedType] = spec.split(':');
    if (!(field in obj)) {
      throw new ValidationError(`Missing required field: ${field}`, field);
    }
    if (expectedType) {
      const value = obj[field];
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== expectedType) {
        throw new ValidationError(
          `Field '${field}' must be ${expectedType}, got ${actualType}`,
          field,
        );
      }
    }
  }
  return body as T;
}

/**
 * Map any error to an HTTP status code and safe response body.
 * EngineError subclasses carry their own httpStatus.
 * Unknown errors → 500 with generic message (no internal details).
 */
function mapErrorToResponse(err: unknown, requestId: string): { status: number; body: Record<string, unknown> } {
  if (err instanceof EngineError) {
    return {
      status: err.httpStatus,
      body: {
        error: err.message,
        code: err.code,
        requestId,
      },
    };
  }

  // Don't leak internal error details to clients
  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    status: 500,
    body: {
      error: message,
      requestId,
    },
  };
}

// --- Route handlers ---

async function handleListCharacters(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const characters = engine.getAllCharacters();
  const enriched = characters.map(c => ({
    ...c,
    proximity: engine.getCloseness(c.id),
  }));
  sendJson(res, 200, { characters: enriched });
}

async function handleGetCharacter(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const char = engine.getCharacter(req.params.id);
  if (!char) {
    sendJson(res, 404, { error: `Character not found: ${req.params.id}` });
    return;
  }
  sendJson(res, 200, {
    character: char,
    proximity: engine.getCloseness(char.id),
    emotions: engine.emotions.getEmotions(char.id),
    mood: engine.emotions.getMood(char.id),
  });
}

async function handleRegisterCharacter(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const def = requireBody<any>(req.body, 'id:string', 'name:string', 'archetype:string', 'identity');
  const state = engine.registerCharacter(def, req.query.playerId);
  sendJson(res, 201, { character: state });
}

async function handleRemoveCharacter(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const char = engine.getCharacter(req.params.id);
  if (!char) {
    sendJson(res, 404, { error: `Character not found: ${req.params.id}` });
    return;
  }
  engine.agents.remove(req.params.id);
  sendJson(res, 200, { removed: req.params.id });
}

async function handleIntrospection(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const introspection = engine.getCharacterIntrospection(req.params.id, req.query.playerId);
  if (!introspection) {
    sendJson(res, 404, { error: `Character not found: ${req.params.id}` });
    return;
  }
  sendJson(res, 200, introspection);
}

async function handleChat(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ message: string; playerId?: string }>(req.body, 'message:string');
  const reply = await engine.chatWith(req.params.characterId, body.message, body.playerId);
  sendJson(res, 200, { reply });
}

async function handleInjectEvent(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ event: any; playerId?: string }>(req.body, 'event');
  await engine.injectEvent(body.event, body.playerId);
  sendJson(res, 200, { injected: true });
}

async function handleGetProximity(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const score = engine.getCloseness(req.params.characterId, req.query.playerId);
  if (!score) {
    sendJson(res, 404, { error: `No proximity data for: ${req.params.characterId}` });
    return;
  }
  sendJson(res, 200, score);
}

async function handleBoostProximity(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ amount: number; playerId?: string }>(req.body, 'amount:number');
  const score = engine.boostCloseness(req.params.characterId, body.amount, body.playerId);
  sendJson(res, 200, score);
}

async function handleQueryDecisions(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const filters = (req.body as any) ?? {};
  const decisions = engine.queryDecisions(filters);
  sendJson(res, 200, { decisions, count: decisions.length });
}

async function handleCountDecisions(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const count = engine.countDecisions();
  sendJson(res, 200, { count });
}

async function handleApplyEmotion(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ emotion: string; intensity: number }>(req.body, 'emotion:string', 'intensity:number');
  engine.applyEmotion(req.params.characterId, body.emotion as any, body.intensity);
  const emotions = engine.emotions.getEmotions(req.params.characterId);
  sendJson(res, 200, { emotions });
}

async function handleSetRelationship(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ fromId: string; toId: string; type?: string; strength?: number; trust?: number }>(
    req.body, 'fromId:string', 'toId:string',
  );
  const rel = engine.setRelationship(body.fromId, body.toId, {
    type: body.type as any,
    strength: body.strength,
    trust: body.trust,
  });
  sendJson(res, 200, { relationship: rel });
}

async function handleAddGoal(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ description: string; priority?: number; steps?: any[] }>(req.body, 'description:string');
  const goal = engine.addGoal(req.params.characterId, body.description, body.priority, body.steps);
  sendJson(res, 201, { goal });
}

async function handleSetWorldFact(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ key: string; value: unknown; category: string; source: string }>(
    req.body, 'key:string', 'value', 'category:string', 'source:string',
  );
  engine.setWorldFact(body.key, body.value, body.category, body.source);
  sendJson(res, 200, { set: true, key: body.key });
}

async function handleGetWorldFact(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const value = engine.getWorldFact(req.params.key);
  if (value === undefined) {
    sendJson(res, 404, { error: `World fact not found: ${req.params.key}` });
    return;
  }
  sendJson(res, 200, { key: req.params.key, value });
}

async function handleCreateGroup(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ name: string; memberIds: string[]; purpose: string }>(
    req.body, 'name:string', 'memberIds:array', 'purpose:string',
  );
  const group = engine.createGroup(body.name, body.memberIds, body.purpose);
  sendJson(res, 201, { group });
}

async function handleStartConversation(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ participantIds: string[]; topic: string; maxTurns?: number }>(
    req.body, 'participantIds:array', 'topic:string',
  );
  const convo = await engine.startConversation(body.participantIds, body.topic, body.maxTurns);
  sendJson(res, 201, { conversation: convo });
}

async function handlePersistState(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  engine.persistState();
  sendJson(res, 200, { saved: true });
}

async function handleSaveSnapshot(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const name = (req.body as any)?.name;
  const id = engine.saveSnapshot(name);
  sendJson(res, 201, { snapshotId: id });
}

async function handleListSnapshots(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const snapshots = engine.listSnapshots();
  sendJson(res, 200, { snapshots });
}

async function handleExportState(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const state = engine.exportState();
  sendJson(res, 200, state);
}

async function handleImportState(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const data = requireBody<Record<string, unknown>>(req.body);
  engine.importState(data);
  sendJson(res, 200, { imported: true });
}

async function handleStats(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const stats = engine.getStats();
  sendJson(res, 200, stats);
}

async function handleHealth(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const health = await engine.healthCheck();
  const status = health.inference && health.database ? 200 : 503;
  sendJson(res, status, health);
}

async function handleMetrics(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const snapshot = engine.metrics.getSnapshot();
  sendJson(res, 200, snapshot);
}

async function handleUpdateConfig(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ tick?: any; proximity?: any }>(req.body);
  engine.updateConfig(body);
  sendJson(res, 200, { updated: true });
}

async function handleGetExperiment(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const report = engine.experiment.getReport();
  sendJson(res, 200, report);
}

async function handleAddVariant(req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  const body = requireBody<{ name: string; config: any; weight?: number }>(req.body, 'name:string', 'config');
  engine.experiment.registerVariant(body.name, body.config, body.weight);
  sendJson(res, 201, { registered: body.name });
}

async function handleStartExperiment(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  engine.experiment.start();
  sendJson(res, 200, { started: true, active: engine.experiment.isActive });
}

async function handleStopExperiment(_req: ParsedRequest, res: ServerResponse, engine: Engine): Promise<void> {
  engine.experiment.stop();
  const report = engine.experiment.getReport();
  sendJson(res, 200, { stopped: true, report });
}
