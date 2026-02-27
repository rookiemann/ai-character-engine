import type {
  AgentDecisionRequest,
  AgentDecisionResult,
  ToolCall,
  ToolResult,
  CharacterState,
} from './types';
import { getLogger } from './logger';

export type MiddlewarePhase =
  | 'beforeDecision' | 'afterDecision'
  | 'beforeToolExec' | 'afterToolExec'
  | 'beforeChat' | 'afterChat';

export interface MiddlewareContext {
  characterId: string;
  playerId: string;
  phase: MiddlewarePhase;
  request?: AgentDecisionRequest;
  result?: AgentDecisionResult;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  character?: CharacterState;
  /** Set to true in middleware to abort the current operation */
  abort?: boolean;
  /** Arbitrary metadata for middleware to share data */
  metadata: Record<string, unknown>;
}

export type MiddlewareFn = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;

/**
 * MiddlewarePipeline — classic next() pattern middleware.
 * Supports per-phase registration and ordered execution.
 */
export class MiddlewarePipeline {
  private handlers = new Map<MiddlewarePhase, MiddlewareFn[]>();
  private log = getLogger('middleware');

  /**
   * Register a middleware function for a specific phase.
   */
  use(phase: MiddlewarePhase, fn: MiddlewareFn): void {
    if (!this.handlers.has(phase)) {
      this.handlers.set(phase, []);
    }
    this.handlers.get(phase)!.push(fn);
  }

  /**
   * Remove a middleware function from a phase.
   */
  remove(phase: MiddlewarePhase, fn: MiddlewareFn): void {
    const fns = this.handlers.get(phase);
    if (!fns) return;
    const idx = fns.indexOf(fn);
    if (idx !== -1) fns.splice(idx, 1);
  }

  /**
   * Run all middleware for a phase in order.
   * Each middleware calls next() to pass control to the next one.
   */
  async run(phase: MiddlewarePhase, ctx: MiddlewareContext): Promise<void> {
    const fns = this.handlers.get(phase);
    if (!fns || fns.length === 0) return;

    let index = 0;
    const next = async (): Promise<void> => {
      if (index >= fns.length) return;
      if (ctx.abort) return;
      const fn = fns[index++];
      try {
        await fn(ctx, next);
      } catch (err) {
        this.log.error({ phase, error: (err as Error).message }, 'Middleware error');
        throw err;
      }
    };

    await next();
  }

  /**
   * Check if any middleware is registered for a phase.
   */
  has(phase: MiddlewarePhase): boolean {
    const fns = this.handlers.get(phase);
    return !!fns && fns.length > 0;
  }

  /**
   * Clear all middleware for all phases.
   */
  clear(): void {
    this.handlers.clear();
  }
}
