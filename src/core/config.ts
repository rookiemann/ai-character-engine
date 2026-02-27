import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import type { EngineConfig, ProximityConfig, TickConfig } from './types';
import { ConfigError } from './errors';

const providerConfigSchema = z.object({
  type: z.enum(['lmstudio', 'openrouter', 'openai', 'anthropic', 'vllm', 'ollama']),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  models: z.object({
    heavy: z.string(),
    mid: z.string(),
    light: z.string(),
  }),
  modelsPool: z.object({
    heavy: z.array(z.string()).optional(),
    mid: z.array(z.string()).optional(),
    light: z.array(z.string()).optional(),
  }).optional(),
  maxConcurrency: z.number().min(1).max(100).optional(),
  timeoutMs: z.number().min(1000).optional(),
  maxRetries: z.number().min(0).max(10).optional(),
  gpuId: z.number().min(0).max(15).optional(),
});

const engineConfigSchema = z.object({
  database: z.object({
    path: z.string(),
  }),
  inference: providerConfigSchema,
  embedding: providerConfigSchema.optional(),
  proximity: z.object({
    decayRatePerTick: z.number().optional(),
    interactionBoost: z.number().optional(),
    chatBoost: z.number().optional(),
    promotionThreshold: z.number().optional(),
    backgroundThreshold: z.number().optional(),
    dormantThreshold: z.number().optional(),
    chatMinCloseness: z.number().optional(),
    delegateMinCloseness: z.number().optional(),
    highWaterDecayMultiplier: z.number().optional(),
  }).optional().default({}),
  tick: z.object({
    fastTickMs: z.number().optional(),
    slowTickMs: z.number().optional(),
    maxAgentsPerFastTick: z.number().optional(),
    maxAgentsPerSlowTick: z.number().optional(),
    batchSize: z.number().optional(),
  }).optional().default({}),
  memory: z.object({
    workingMemorySize: z.number().optional(),
    episodicRetrievalCount: z.number().optional(),
    importanceThreshold: z.number().optional(),
    decayInterval: z.number().optional(),
    pruneThreshold: z.number().optional(),
    summaryRegenerateInterval: z.number().optional(),
  }).optional().default({}),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    pretty: z.boolean().optional(),
  }).optional().default({}),
});

export const DEFAULT_PROXIMITY: ProximityConfig = {
  decayRatePerTick: 0.1,
  interactionBoost: 4,
  chatBoost: 2,
  promotionThreshold: 60,
  backgroundThreshold: 20,
  dormantThreshold: 5,
  chatMinCloseness: 40,
  delegateMinCloseness: 60,
  highWaterDecayMultiplier: 0.5,
};

export const DEFAULT_TICK: TickConfig = {
  fastTickMs: 2000,
  slowTickMs: 30000,
  maxAgentsPerFastTick: 15,
  maxAgentsPerSlowTick: 50,
  batchSize: 10,
};

export const DEFAULT_MEMORY = {
  workingMemorySize: 5,
  episodicRetrievalCount: 5,
  importanceThreshold: 3,
  decayInterval: 10,
  pruneThreshold: 0.5,
  summaryRegenerateInterval: 50,
};

export const DEFAULT_LOGGING = {
  level: 'info' as const,
  pretty: true,
};

export function validateConfig(raw: unknown): EngineConfig {
  const result = engineConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid config: ${messages.join('; ')}`);
  }

  const parsed = result.data;

  return {
    database: parsed.database,
    inference: {
      ...parsed.inference,
      maxConcurrency: parsed.inference.maxConcurrency ?? 10,
      timeoutMs: parsed.inference.timeoutMs ?? 30000,
      maxRetries: parsed.inference.maxRetries ?? 2,
    },
    ...(parsed.embedding ? {
      embedding: {
        ...parsed.embedding,
        maxConcurrency: parsed.embedding.maxConcurrency ?? 4,
        timeoutMs: parsed.embedding.timeoutMs ?? 10000,
        maxRetries: parsed.embedding.maxRetries ?? 1,
      },
    } : {}),
    proximity: { ...DEFAULT_PROXIMITY, ...parsed.proximity },
    tick: { ...DEFAULT_TICK, ...parsed.tick },
    memory: { ...DEFAULT_MEMORY, ...parsed.memory },
    logging: { ...DEFAULT_LOGGING, ...parsed.logging },
  };
}

/**
 * Load and validate an EngineConfig from a JSON file.
 * Defaults to `engine.config.json` in the current working directory.
 * Unknown keys (e.g. `_comment`) are stripped by Zod automatically.
 */
export function loadConfigFile(filePath?: string): EngineConfig {
  const resolved = path.resolve(filePath ?? 'engine.config.json');

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Failed to read config file "${resolved}": ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid JSON in config file "${resolved}": ${message}`);
  }

  return validateConfig(parsed);
}
