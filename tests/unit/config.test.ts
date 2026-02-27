import { describe, it, expect } from 'vitest';
import { validateConfig, DEFAULT_PROXIMITY, DEFAULT_TICK, DEFAULT_MEMORY, DEFAULT_LOGGING } from '../../src/core/config';
import { ConfigError } from '../../src/core/errors';

const validInference = {
  type: 'vllm' as const,
  baseUrl: 'http://localhost:8100/v1',
  models: { heavy: 'test', mid: 'test', light: 'test' },
};

function makeRawConfig(overrides: Record<string, unknown> = {}) {
  return {
    database: { path: ':memory:' },
    inference: validInference,
    ...overrides,
  };
}

describe('validateConfig', () => {
  it('should accept a minimal valid config', () => {
    const config = validateConfig(makeRawConfig());
    expect(config.database.path).toBe(':memory:');
    expect(config.inference.type).toBe('vllm');
  });

  it('should merge default proximity values', () => {
    const config = validateConfig(makeRawConfig());
    expect(config.proximity).toEqual(DEFAULT_PROXIMITY);
  });

  it('should merge default tick values', () => {
    const config = validateConfig(makeRawConfig());
    expect(config.tick).toEqual(DEFAULT_TICK);
  });

  it('should merge default memory values', () => {
    const config = validateConfig(makeRawConfig());
    expect(config.memory).toEqual(DEFAULT_MEMORY);
  });

  it('should merge default logging values', () => {
    const config = validateConfig(makeRawConfig());
    expect(config.logging).toEqual(DEFAULT_LOGGING);
  });

  it('should apply default maxConcurrency/timeout/retries to inference', () => {
    const config = validateConfig(makeRawConfig());
    expect(config.inference.maxConcurrency).toBe(10);
    expect(config.inference.timeoutMs).toBe(30000);
    expect(config.inference.maxRetries).toBe(2);
  });

  it('should throw ConfigError when database.path is missing', () => {
    expect(() => validateConfig({ inference: validInference })).toThrow(ConfigError);
  });

  it('should throw ConfigError when inference is missing', () => {
    expect(() => validateConfig({ database: { path: ':memory:' } })).toThrow(ConfigError);
  });

  it('should throw ConfigError for invalid provider type', () => {
    expect(() => validateConfig(makeRawConfig({
      inference: { ...validInference, type: 'banana' },
    }))).toThrow(ConfigError);
  });

  it('should accept optional embedding config', () => {
    const config = validateConfig(makeRawConfig({
      embedding: {
        type: 'vllm',
        baseUrl: 'http://localhost:8101/v1',
        models: { heavy: 'embed', mid: 'embed', light: 'embed' },
      },
    }));
    expect(config.embedding).toBeDefined();
    expect(config.embedding!.type).toBe('vllm');
    expect(config.embedding!.maxConcurrency).toBe(4);
  });
});
