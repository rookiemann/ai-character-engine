export class EngineError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'EngineError';
  }

  /** HTTP status code for API responses. Override in subclasses. */
  get httpStatus(): number { return 500; }

  /** Whether this error is transient and the operation can be retried. */
  get retriable(): boolean { return false; }
}

export class ConfigError extends EngineError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
  get httpStatus(): number { return 400; }
}

export class ValidationError extends EngineError {
  constructor(message: string, public readonly field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
  get httpStatus(): number { return 400; }
}

export class InferenceError extends EngineError {
  public readonly provider?: string;
  public readonly statusCode?: number;

  constructor(
    message: string,
    provider?: string,
    statusCode?: number,
    code: string = 'INFERENCE_ERROR',
  ) {
    super(message, code);
    this.name = 'InferenceError';
    this.provider = provider;
    this.statusCode = statusCode;
  }
  get httpStatus(): number { return 503; }
  get retriable(): boolean {
    if (this.statusCode === undefined) return true;
    return this.statusCode >= 500 || this.statusCode === 429;
  }
}

export class TimeoutError extends InferenceError {
  constructor(message: string, provider?: string) {
    super(message, provider, 408, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
  get retriable(): boolean { return true; }
}

export class RateLimitError extends InferenceError {
  public readonly retryAfterMs?: number;

  constructor(message: string, provider?: string, retryAfterMs?: number) {
    super(message, provider, 429, 'RATE_LIMIT_ERROR');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
  get retriable(): boolean { return true; }
}

export class ToolError extends EngineError {
  constructor(message: string, public readonly toolName?: string) {
    super(message, 'TOOL_ERROR');
    this.name = 'ToolError';
  }
  get httpStatus(): number { return 400; }
}

export class MemoryError extends EngineError {
  constructor(message: string) {
    super(message, 'MEMORY_ERROR');
    this.name = 'MemoryError';
  }
}

export class PluginError extends EngineError {
  constructor(message: string, public readonly pluginId?: string) {
    super(message, 'PLUGIN_ERROR');
    this.name = 'PluginError';
  }
}

export class ProximityError extends EngineError {
  constructor(message: string) {
    super(message, 'PROXIMITY_ERROR');
    this.name = 'ProximityError';
  }
}

export class AgentError extends EngineError {
  constructor(message: string, public readonly characterId?: string) {
    super(message, 'AGENT_ERROR');
    this.name = 'AgentError';
  }
}
