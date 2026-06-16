import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  DEFAULT_RATE_LIMIT_RULES,
  clientRateLimitKey,
  createRateLimiterMiddleware,
  matchingRateLimitRule,
} from '../../../src/middleware/rate-limiter.ts';

function app(now: () => number, key?: (request: Request) => string) {
  return new Elysia()
    .use(createRateLimiterMiddleware({
      now,
      key,
      rules: [
        { path: '/api/search', limit: 2, windowMs: 1_000 },
        { path: '/api/learn', limit: 1, windowMs: 1_000, methods: ['POST'] },
      ],
    }))
    .get('/api/search', () => ({ ok: true }))
    .post('/api/learn', () => ({ ok: true }))
    .get('/api/health', () => ({ ok: true }));
}

async function json(res: Response) {
  return await res.json() as Record<string, unknown>;
}

describe('rate limiter middleware', () => {
  test('limits configured routes and returns standard 429 JSON', async () => {
    let clock = 1_000;
    const local = app(() => clock);

    expect((await local.handle(new Request('http://local/api/search'))).status).toBe(200);
    expect((await local.handle(new Request('http://local/api/search'))).headers.get('RateLimit-Remaining')).toBe('0');

    const limited = await local.handle(new Request('http://local/api/search'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('1');
    expect(await json(limited)).toMatchObject({
      success: false,
      error: 'rate_limit_exceeded',
      code: 429,
      details: { limit: 2, windowMs: 1_000, retryAfterSeconds: 1 },
    });

    clock = 2_001;
    expect((await local.handle(new Request('http://local/api/search'))).status).toBe(200);
  });

  test('uses per-route and per-client buckets', async () => {
    const local = app(() => 1_000);

    expect((await local.handle(new Request('http://local/api/learn', { method: 'POST' }))).status).toBe(200);
    expect((await local.handle(new Request('http://local/api/learn', { method: 'POST' }))).status).toBe(429);
    expect((await local.handle(new Request('http://local/api/health'))).status).toBe(200);

    const otherClient = await local.handle(new Request('http://local/api/learn', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    }));
    expect(otherClient.status).toBe(200);
  });

  test('exposes default matching and client key helpers', () => {
    const search = new Request('http://local/api/search', { headers: { 'cf-connecting-ip': '198.51.100.3' } });
    const learn = new Request('http://local/api/learn', { method: 'POST' });

    expect(DEFAULT_RATE_LIMIT_RULES.map((rule) => rule.limit)).toEqual([30, 10]);
    expect(matchingRateLimitRule(search)?.limit).toBe(30);
    expect(matchingRateLimitRule(learn)?.limit).toBe(10);
    expect(clientRateLimitKey(search)).toBe('GET /api/search 198.51.100.3');
  });
});
