import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createRateLimitMiddleware,
  isRateLimitBypassed,
  rateLimitRpmFromEnv,
} from '../../../src/middleware/rate-limit.ts';

function createApp(options: Parameters<typeof createRateLimitMiddleware>[0] = {}) {
  return new Elysia()
    .use(createRateLimitMiddleware(options))
    .get('/api/health', () => ({ status: 'ok' }))
    .get('/api/search', () => ({ ok: true }));
}

async function get(app: Elysia, path: string, headers: Record<string, string> = {}) {
  return app.handle(new Request(`http://local${path}`, { headers }));
}

async function json(res: Response) {
  return await res.json() as Record<string, unknown>;
}

describe('rate limit sliding window middleware', () => {
  test('blocks requests above the per-IP limit with structured 429 JSON', async () => {
    const app = createApp({ rpm: 2, windowMs: 1_000, now: () => 1_000 });
    const headers = { 'x-forwarded-for': '203.0.113.7', 'x-correlation-id': 'rate-limit-test' };

    expect((await get(app, '/api/search', headers)).status).toBe(200);
    expect((await get(app, '/api/search', headers)).status).toBe(200);

    const blocked = await get(app, '/api/search', headers);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('1');
    expect(blocked.headers.get('X-Request-Id')).toBe('rate-limit-test');
    expect(blocked.headers.get('x-correlation-id')).toBe('rate-limit-test');
    expect(await json(blocked)).toEqual({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded: 2 requests per 1 seconds',
      statusCode: 429,
      correlationId: 'rate-limit-test',
    });
  });

  test('expires old requests as the sliding window advances', async () => {
    let now = 1_000;
    const app = createApp({ rpm: 1, windowMs: 1_000, now: () => now });
    const headers = { 'x-forwarded-for': '203.0.113.8' };

    expect((await get(app, '/api/search', headers)).status).toBe(200);
    expect((await get(app, '/api/search', headers)).status).toBe(429);

    now = 2_001;
    expect((await get(app, '/api/search', headers)).status).toBe(200);
  });

  test('tracks windows independently per client IP', async () => {
    const app = createApp({ rpm: 1, windowMs: 1_000, now: () => 1_000 });

    expect((await get(app, '/api/search', { 'x-forwarded-for': '203.0.113.9' })).status).toBe(200);
    expect((await get(app, '/api/search', { 'x-forwarded-for': '203.0.113.9' })).status).toBe(429);
    expect((await get(app, '/api/search', { 'x-forwarded-for': '203.0.113.10' })).status).toBe(200);
  });

  test('bypasses rate limiting for the health endpoint', async () => {
    const app = createApp({ rpm: 1, windowMs: 1_000, now: () => 1_000 });
    const headers = { 'x-forwarded-for': '203.0.113.11' };

    expect((await get(app, '/api/search', headers)).status).toBe(200);
    expect((await get(app, '/api/search', headers)).status).toBe(429);
    expect((await get(app, '/api/health', headers)).status).toBe(200);
    expect((await get(app, '/api/health', headers)).status).toBe(200);
  });

  test('uses a positive integer env limit or falls back to the default', () => {
    expect(rateLimitRpmFromEnv('125')).toBe(125);
    expect(rateLimitRpmFromEnv('2.9')).toBe(2);
    expect(rateLimitRpmFromEnv('0')).toBe(60);
    expect(rateLimitRpmFromEnv('not-a-number')).toBe(60);
  });

  test('only marks the health route as bypassed', () => {
    expect(isRateLimitBypassed('/api/health')).toBe(true);
    expect(isRateLimitBypassed('/api/healthz')).toBe(false);
    expect(isRateLimitBypassed('/api/search')).toBe(false);
  });
});
