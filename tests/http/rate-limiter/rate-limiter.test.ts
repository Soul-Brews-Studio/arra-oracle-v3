import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  DEFAULT_RATE_LIMIT_RULES,
  clientRateLimitKey,
  createRateLimiterMiddleware,
  matchingRateLimitRule,
} from '../../../src/middleware/rate-limiter.ts';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';

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
    const versioned = new Request('http://local/api/v1/search', { headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' } });

    expect(DEFAULT_RATE_LIMIT_RULES.map((rule) => rule.limit)).toEqual([30, 10]);
    expect(matchingRateLimitRule(search)?.limit).toBe(30);
    expect(matchingRateLimitRule(versioned)?.limit).toBe(30);
    expect(matchingRateLimitRule(learn)?.limit).toBe(10);
    expect(clientRateLimitKey(search)).toBe('GET /api/search 198.51.100.3');
    expect(clientRateLimitKey(versioned)).toBe('GET /api/search 198.51.100.4');
  });

  test('limits versioned API requests against canonical route buckets', async () => {
    const local = app(() => 1_000);
    const fetchVersioned = createApiVersionedFetch((request) => local.handle(request));

    expect((await fetchVersioned(new Request('http://local/api/v1/search'))).status).toBe(200);
    expect((await fetchVersioned(new Request('http://local/api/search', { redirect: 'manual' }))).status).toBe(308);

    const second = await fetchVersioned(new Request('http://local/api/v1/search'));
    expect(second.status).toBe(200);
    expect(second.headers.get('RateLimit-Remaining')).toBe('0');

    const limited = await fetchVersioned(new Request('http://local/api/v1/search'));
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ error: 'rate_limit_exceeded' });
  });
});
