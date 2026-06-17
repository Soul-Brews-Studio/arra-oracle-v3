import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { createApiVersionedFetch } from '../../src/middleware/api-version.ts';
import { createApiKeyAuthMiddleware } from '../../src/middleware/auth.ts';
import { createContentTypeMiddleware } from '../../src/middleware/content-type.ts';
import { createCorrelationMiddleware } from '../../src/middleware/correlation.ts';
import { createCorsMiddleware, parseCorsOrigins } from '../../src/middleware/cors.ts';
import { BadRequestError, createErrorMiddleware } from '../../src/middleware/errors.ts';
import { createRateLimiterMiddleware } from '../../src/middleware/rate-limiter.ts';

const previousApiKey = process.env.ARRA_API_KEY;

afterEach(() => {
  if (previousApiKey === undefined) delete process.env.ARRA_API_KEY;
  else process.env.ARRA_API_KEY = previousApiKey;
});

function createStackedApp(now = (() => 1_000)) {
  process.env.ARRA_API_KEY = 'secret';
  return new Elysia()
    .use(createCorsMiddleware(parseCorsOrigins('https://studio.example')))
    .use(createApiKeyAuthMiddleware())
    .use(createRateLimiterMiddleware({
      now,
      rules: [{ path: '/api/fail', limit: 2, windowMs: 60_000 }],
    }))
    .use(createCorrelationMiddleware())
    .use(createContentTypeMiddleware())
    .use(createErrorMiddleware(() => undefined))
    .post('/api/echo', ({ body, requestId }) => ({ body, requestId }), {
      body: t.Object({ name: t.String() }),
    })
    .get('/api/fail', () => {
      throw new BadRequestError('stack boom');
    });
}

function jsonRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('origin', 'https://studio.example');
  headers.set('accept', headers.get('accept') ?? 'application/json');
  if (!headers.has('authorization')) headers.set('authorization', 'Bearer secret');
  return new Request(`http://local${path}`, { ...init, headers });
}

describe('middleware stack integration', () => {
  test('exercises cors, auth, rate-limit, correlation, content-type, body parsing, and errors in order', async () => {
    const app = createStackedApp();

    const preflight = await app.handle(jsonRequest('/api/echo', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');

    const unauthenticated = await app.handle(jsonRequest('/api/echo', {
      method: 'POST',
      headers: { authorization: '', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'blocked' }),
    }));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');
    expect(await unauthenticated.json()).toMatchObject({ error: 'api_key_auth_required' });

    const unsupported = await app.handle(jsonRequest('/api/echo', {
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'application/json', 'x-forwarded-for': 'content-type-client' },
      body: JSON.stringify({ name: 'html' }),
    }));
    expect(unsupported.status).toBe(406);
    expect(unsupported.headers.get('X-Request-Id')).toBeTruthy();
    expect(await unsupported.json()).toMatchObject({ error: 'not_acceptable' });

    const parsed = await app.handle(jsonRequest('/api/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'body-client' },
      body: JSON.stringify({ name: 'oracle' }),
    }));
    const parsedBody = await parsed.json() as { body: { name: string }; requestId: string };
    expect(parsed.status).toBe(200);
    expect(parsed.headers.get('Content-Type')).toBe('application/json');
    expect(parsedBody.body).toEqual({ name: 'oracle' });
    expect(parsed.headers.get('X-Request-Id')).toBe(parsedBody.requestId);

    const failed = await app.handle(jsonRequest('/api/fail', {
      headers: { 'x-forwarded-for': 'error-client' },
    }));
    const failedBody = await failed.json() as { code: number; details: { correlationId: string } };
    expect(failed.status).toBe(400);
    expect(failedBody.code).toBe(400);
    expect(failed.headers.get('X-Request-Id')).toBe(failedBody.details.correlationId);

    const firstLimited = await app.handle(jsonRequest('/api/fail', {
      headers: { 'x-forwarded-for': 'limited-client' },
    }));
    const secondLimited = await app.handle(jsonRequest('/api/fail', {
      headers: { 'x-forwarded-for': 'limited-client' },
    }));
    const thirdLimited = await app.handle(jsonRequest('/api/fail', {
      headers: { 'x-forwarded-for': 'limited-client' },
    }));
    expect(firstLimited.status).toBe(400);
    expect(secondLimited.status).toBe(400);
    expect(thirdLimited.status).toBe(429);
    expect(thirdLimited.headers.get('Retry-After')).toBe('60');
    expect(await thirdLimited.json()).toMatchObject({ error: 'rate_limit_exceeded' });
  });

  test('keeps auth and rate-limit behavior intact after /api/v1 rewrite', async () => {
    const app = createStackedApp();
    const fetchVersioned = createApiVersionedFetch((request) => app.handle(request));

    const unauthenticated = await fetchVersioned(jsonRequest('/api/v1/fail', {
      headers: { authorization: '' },
    }));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');

    const headers = { 'x-forwarded-for': 'versioned-limited-client' };
    const first = await fetchVersioned(jsonRequest('/api/v1/fail', { headers }));
    const second = await fetchVersioned(jsonRequest('/api/v1/fail', { headers }));
    const third = await fetchVersioned(jsonRequest('/api/v1/fail', { headers }));

    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: 'rate_limit_exceeded' });
  });
});
