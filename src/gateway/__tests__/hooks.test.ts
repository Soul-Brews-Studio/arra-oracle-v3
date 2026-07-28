/**
 * Unit tests for gateway hook pipeline — load, run, short-circuit.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  registerHook,
  loadHooks,
  runHooks,
  type GatewayContext,
  type GatewayHook,
} from '../hooks.ts';

// ── helpers ────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    request: new Request('http://localhost/api/test'),
    meta: {},
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────

describe('gateway hooks', () => {
  // Register test hooks
  beforeEach(() => {
    registerHook({
      name: 'test-noop',
      phase: 'onRequest',
      handler: () => {},
    });
    registerHook({
      name: 'test-short-circuit',
      phase: 'onRequest',
      handler: () => new Response('blocked', { status: 403 }),
    });
    registerHook({
      name: 'test-error-handler',
      phase: 'onError',
      handler: (ctx) =>
        new Response(JSON.stringify({ caught: ctx.error?.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
  });

  test('loadHooks returns empty pipeline when config is undefined', () => {
    const pipeline = loadHooks(undefined);
    expect(pipeline.onRequest).toEqual([]);
    expect(pipeline.onResponse).toEqual([]);
    expect(pipeline.onError).toEqual([]);
  });

  test('loadHooks resolves known hook names', () => {
    const pipeline = loadHooks({ onRequest: ['test-noop'] });
    expect(pipeline.onRequest).toHaveLength(1);
    expect(pipeline.onRequest[0].name).toBe('test-noop');
  });

  test('loadHooks skips unknown hook names', () => {
    const pipeline = loadHooks({ onRequest: ['does-not-exist'] });
    expect(pipeline.onRequest).toEqual([]);
  });

  test('loadHooks skips phase mismatch', () => {
    // test-noop is registered as onRequest, not onResponse
    const pipeline = loadHooks({ onResponse: ['test-noop'] });
    expect(pipeline.onResponse).toEqual([]);
  });

  test('runHooks returns void when no hooks short-circuit', async () => {
    const pipeline = loadHooks({ onRequest: ['test-noop'] });
    const result = await runHooks(pipeline.onRequest, makeCtx());
    expect(result).toBeUndefined();
  });

  test('runHooks returns Response when a hook short-circuits', async () => {
    const pipeline = loadHooks({ onRequest: ['test-short-circuit'] });
    const result = await runHooks(pipeline.onRequest, makeCtx());
    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(403);
  });

  test('first short-circuit wins — later hooks do not run', async () => {
    const calls: string[] = [];
    registerHook({
      name: 'test-tracker',
      phase: 'onRequest',
      handler: () => { calls.push('tracker'); },
    });
    const pipeline = loadHooks({
      onRequest: ['test-short-circuit', 'test-tracker'],
    });
    await runHooks(pipeline.onRequest, makeCtx());
    expect(calls).toEqual([]); // tracker never ran
  });

  test('onError hook receives ctx.error', async () => {
    const pipeline = loadHooks({ onError: ['test-error-handler'] });
    const ctx = makeCtx({ error: new Error('boom') });
    const result = await runHooks(pipeline.onError, ctx);
    expect(result).toBeInstanceOf(Response);
    const body = await result!.json();
    expect(body.caught).toBe('boom');
  });

  test('hooks can read and write ctx.meta', async () => {
    registerHook({
      name: 'test-meta-writer',
      phase: 'onRequest',
      handler: (ctx) => { ctx.meta.seen = true; },
    });
    const pipeline = loadHooks({ onRequest: ['test-meta-writer'] });
    const ctx = makeCtx();
    await runHooks(pipeline.onRequest, ctx);
    expect(ctx.meta.seen).toBe(true);
  });
});
