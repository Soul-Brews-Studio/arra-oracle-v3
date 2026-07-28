import { describe, it, expect, beforeEach } from 'bun:test';
import { loadHooks, runHooks, type GatewayContext } from '../hooks.ts';
import { _resetRateLimitState } from '../hooks/rate-limit.ts';

const pipeline = loadHooks({ onRequest: ['rate-limit'] });
const run = (ctx: GatewayContext) => runHooks(pipeline.onRequest, ctx);

function ctxFor(ip: string, opts: Record<string, unknown> = {}): GatewayContext {
  return {
    request: new Request('http://localhost/api/search', {
      headers: { 'x-forwarded-for': ip },
    }),
    meta: { hook_options: { 'rate-limit': opts } },
  };
}

describe('rate-limit hook', () => {
  beforeEach(() => {
    _resetRateLimitState();
  });

  it('allows requests within the burst', async () => {
    const opts = { tokens_per_window: 60, window_ms: 60_000, burst: 3 };
    expect(await run(ctxFor('1.1.1.1', opts))).toBeUndefined();
    expect(await run(ctxFor('1.1.1.1', opts))).toBeUndefined();
    expect(await run(ctxFor('1.1.1.1', opts))).toBeUndefined();
  });

  it('blocks the 4th request with 429 once burst is drained', async () => {
    const opts = { tokens_per_window: 60, window_ms: 60_000, burst: 3 };
    await run(ctxFor('2.2.2.2', opts));
    await run(ctxFor('2.2.2.2', opts));
    await run(ctxFor('2.2.2.2', opts));
    const blocked = await run(ctxFor('2.2.2.2', opts));
    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(429);
    const body = await (blocked as Response).json();
    expect(body.error).toBe('rate_limited');
    expect(body.retry_after_seconds).toBeGreaterThan(0);
    expect((blocked as Response).headers.get('Retry-After')).toBeDefined();
  });

  it('isolates buckets per client key', async () => {
    const opts = { tokens_per_window: 60, window_ms: 60_000, burst: 1 };
    expect(await run(ctxFor('3.3.3.3', opts))).toBeUndefined();
    // 3.3.3.3 is now drained, but 4.4.4.4 should still have its own bucket
    expect(await run(ctxFor('4.4.4.4', opts))).toBeUndefined();
    // 3.3.3.3 again — blocked
    const blocked = await run(ctxFor('3.3.3.3', opts));
    expect((blocked as Response).status).toBe(429);
  });

  it('refills tokens over time', async () => {
    // 100 tokens per 100ms = 1 per ms. burst=1 → 1ms of wait should refill.
    const opts = { tokens_per_window: 100, window_ms: 100, burst: 1 };
    expect(await run(ctxFor('5.5.5.5', opts))).toBeUndefined();
    // Immediately after, blocked
    const blocked = await run(ctxFor('5.5.5.5', opts));
    expect((blocked as Response).status).toBe(429);
    // Wait long enough for the bucket to refill
    await new Promise((r) => setTimeout(r, 50));
    expect(await run(ctxFor('5.5.5.5', opts))).toBeUndefined();
  });

  it('uses leftmost IP from a comma-separated X-Forwarded-For chain', async () => {
    const opts = { tokens_per_window: 60, window_ms: 60_000, burst: 1 };
    const a: GatewayContext = {
      request: new Request('http://localhost/api/search', {
        headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.1' },
      }),
      meta: { hook_options: { 'rate-limit': opts } },
    };
    const b: GatewayContext = {
      request: new Request('http://localhost/api/search', {
        headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.2' },
      }),
      meta: { hook_options: { 'rate-limit': opts } },
    };
    expect(await run(a)).toBeUndefined();
    // Same leftmost IP — should hit the same bucket and be blocked
    expect((await run(b) as Response).status).toBe(429);
  });

  it('falls back to "anonymous" when the configured header is absent', async () => {
    const opts = { tokens_per_window: 60, window_ms: 60_000, burst: 1 };
    const c: GatewayContext = {
      request: new Request('http://localhost/api/search'),
      meta: { hook_options: { 'rate-limit': opts } },
    };
    expect(await run(c)).toBeUndefined();
    // Second anon request shares the same bucket — blocked
    const d: GatewayContext = {
      request: new Request('http://localhost/api/search'),
      meta: { hook_options: { 'rate-limit': opts } },
    };
    expect((await run(d) as Response).status).toBe(429);
  });

  it('disables itself when tokens_per_window <= 0', async () => {
    const opts = { tokens_per_window: 0, window_ms: 60_000, burst: 1 };
    // No matter how many requests, no 429.
    for (let i = 0; i < 5; i++) {
      expect(await run(ctxFor('7.7.7.7', opts))).toBeUndefined();
    }
  });

  it('uses default settings when no options are provided', async () => {
    // Defaults: 60 tokens / 60s, burst = 60. First request passes.
    const ctx: GatewayContext = {
      request: new Request('http://localhost/api/search', {
        headers: { 'x-forwarded-for': '8.8.8.8' },
      }),
      meta: { hook_options: {} },
    };
    expect(await run(ctx)).toBeUndefined();
  });

  it('respects a custom header name', async () => {
    const opts = {
      header: 'x-real-ip',
      tokens_per_window: 60,
      window_ms: 60_000,
      burst: 1,
    };
    const a: GatewayContext = {
      request: new Request('http://localhost/api/search', {
        headers: { 'x-real-ip': '9.9.9.9' },
      }),
      meta: { hook_options: { 'rate-limit': opts } },
    };
    const b: GatewayContext = {
      request: new Request('http://localhost/api/search', {
        headers: { 'x-real-ip': '9.9.9.9' },
      }),
      meta: { hook_options: { 'rate-limit': opts } },
    };
    expect(await run(a)).toBeUndefined();
    expect((await run(b) as Response).status).toBe(429);
  });
});
