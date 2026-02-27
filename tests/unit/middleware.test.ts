import { describe, it, expect, beforeEach } from 'vitest';
import { MiddlewarePipeline, type MiddlewareFn, type MiddlewareContext } from '../../src/core/Middleware';

function makeCtx(phase: MiddlewareContext['phase'] = 'beforeDecision'): MiddlewareContext {
  return {
    characterId: 'char1',
    playerId: 'default',
    phase,
    metadata: {},
  };
}

describe('MiddlewarePipeline', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  it('should register middleware and report has()', () => {
    expect(pipeline.has('beforeDecision')).toBe(false);
    pipeline.use('beforeDecision', async (_ctx, next) => { await next(); });
    expect(pipeline.has('beforeDecision')).toBe(true);
  });

  it('should run middleware in registration order', async () => {
    const order: number[] = [];
    pipeline.use('beforeDecision', async (_ctx, next) => { order.push(1); await next(); });
    pipeline.use('beforeDecision', async (_ctx, next) => { order.push(2); await next(); });
    pipeline.use('beforeDecision', async (_ctx, next) => { order.push(3); await next(); });

    await pipeline.run('beforeDecision', makeCtx());
    expect(order).toEqual([1, 2, 3]);
  });

  it('should chain next() through all middleware', async () => {
    const executed: string[] = [];
    pipeline.use('afterDecision', async (ctx, next) => {
      executed.push('before-next');
      await next();
      executed.push('after-next');
    });
    pipeline.use('afterDecision', async (_ctx, next) => {
      executed.push('inner');
      await next();
    });

    await pipeline.run('afterDecision', makeCtx('afterDecision'));
    expect(executed).toEqual(['before-next', 'inner', 'after-next']);
  });

  it('should stop when abort is set', async () => {
    const order: number[] = [];
    pipeline.use('beforeDecision', async (ctx, next) => {
      order.push(1);
      ctx.abort = true;
      await next();
    });
    pipeline.use('beforeDecision', async (_ctx, next) => {
      order.push(2);
      await next();
    });

    const ctx = makeCtx();
    await pipeline.run('beforeDecision', ctx);
    expect(order).toEqual([1]);
    expect(ctx.abort).toBe(true);
  });

  it('should not run middleware for wrong phase', async () => {
    let called = false;
    pipeline.use('afterChat', async (_ctx, next) => { called = true; await next(); });

    await pipeline.run('beforeDecision', makeCtx());
    expect(called).toBe(false);
  });

  it('should do nothing for empty middleware list', async () => {
    await pipeline.run('beforeDecision', makeCtx());
    // No error thrown
  });

  it('should propagate errors from middleware', async () => {
    pipeline.use('beforeDecision', async () => {
      throw new Error('middleware boom');
    });

    await expect(pipeline.run('beforeDecision', makeCtx())).rejects.toThrow('middleware boom');
  });

  it('should remove a specific middleware', async () => {
    const fn: MiddlewareFn = async (_ctx, next) => { await next(); };
    let called = false;
    const fn2: MiddlewareFn = async (_ctx, next) => { called = true; await next(); };

    pipeline.use('beforeDecision', fn);
    pipeline.use('beforeDecision', fn2);
    pipeline.remove('beforeDecision', fn);

    await pipeline.run('beforeDecision', makeCtx());
    expect(called).toBe(true);
    // Only fn2 should remain
  });

  it('should clear all middleware', () => {
    pipeline.use('beforeDecision', async (_ctx, next) => { await next(); });
    pipeline.use('afterDecision', async (_ctx, next) => { await next(); });
    pipeline.clear();
    expect(pipeline.has('beforeDecision')).toBe(false);
    expect(pipeline.has('afterDecision')).toBe(false);
  });

  it('should allow metadata sharing between middleware', async () => {
    pipeline.use('beforeDecision', async (ctx, next) => {
      ctx.metadata.value = 42;
      await next();
    });
    pipeline.use('beforeDecision', async (ctx, next) => {
      ctx.metadata.doubled = (ctx.metadata.value as number) * 2;
      await next();
    });

    const ctx = makeCtx();
    await pipeline.run('beforeDecision', ctx);
    expect(ctx.metadata.doubled).toBe(84);
  });
});
