import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  API_VERSION_HEADER,
  apiRequestPath,
  createApiVersionedFetch,
} from '../../../src/middleware/api-version.ts';
import { BadRequestError, createErrorMiddleware } from '../../../src/middleware/errors.ts';

describe('middleware error boundary hardening', () => {
  test('logger failures do not replace the structured API error response', async () => {
    const app = new Elysia()
      .use(createErrorMiddleware(() => { throw new Error('logger unavailable'); }))
      .get('/api/fail', () => { throw new BadRequestError('invalid probe'); });

    const res = await app.handle(new Request('http://local/api/fail', {
      headers: { 'x-request-id': 'error-contract' },
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(res.headers.get('x-request-id')).toBe('error-contract');
    expect(body).toEqual({
      success: false,
      error: 'Bad Request',
      code: 400,
      details: { message: 'invalid probe', correlationId: 'error-contract' },
    });
  });

  test('status-like string fields are normalized to standard HTTP labels', async () => {
    const app = new Elysia()
      .use(createErrorMiddleware(() => undefined))
      .get('/api/conflict', () => {
        throw Object.assign(new Error('duplicate plugin id'), { status: '409' });
      });

    const res = await app.handle(new Request('http://local/api/conflict'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      error: 'Conflict',
      code: 409,
      details: { message: 'duplicate plugin id' },
    });
  });
});

describe('api version 308 redirect contract depth', () => {
  test('root API redirects are permanent, absolute, query-preserving, and skip handlers', async () => {
    let calls = 0;
    const fetcher = createApiVersionedFetch(() => {
      calls += 1;
      return new Response('unexpected');
    });

    const root = await fetcher(new Request('http://local/api?next=%2Fapi%2Fsearch'));
    const slash = await fetcher(new Request('http://local/api/?next=%2Fapi%2Fsearch'));

    expect(root.status).toBe(308);
    expect(root.headers.get('location')).toBe('http://local/api/v1?next=%2Fapi%2Fsearch');
    expect(root.headers.get(API_VERSION_HEADER)).toBe('v1');
    expect(await root.text()).toBe('');
    expect(slash.status).toBe(308);
    expect(slash.headers.get('location')).toBe('http://local/api/v1/?next=%2Fapi%2Fsearch');
    expect(calls).toBe(0);
  });

  test('health subtree bypasses legacy redirects while adjacent API paths still redirect', async () => {
    const app = new Elysia()
      .get('/api/health/deep', () => ({ status: 'ok' }))
      .get('/api/healthz', () => ({ status: 'healthz' }));
    const fetcher = createApiVersionedFetch((request) => app.handle(request));

    const deep = await fetcher(new Request('http://local/api/health/deep'));
    const adjacent = await fetcher(new Request('http://local/api/healthz'));

    expect(deep.status).toBe(200);
    expect(await deep.json()).toEqual({ status: 'ok' });
    expect(adjacent.status).toBe(308);
    expect(adjacent.headers.get('location')).toBe('http://local/api/v1/healthz');
  });

  test('versioned POST rewrites preserve method, body, headers, and public path', async () => {
    const app = new Elysia().post('/api/echo', async ({ request }) => ({
      method: request.method,
      routePath: new URL(request.url).pathname,
      publicPath: apiRequestPath(request),
      tenant: request.headers.get('x-oracle-tenant'),
      body: await request.json(),
    }));
    const fetcher = createApiVersionedFetch((request) => app.handle(request));

    const res = await fetcher(new Request('http://local/api/v1/echo?trace=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-oracle-tenant': 'tenant-a' },
      body: JSON.stringify({ ok: true }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get(API_VERSION_HEADER)).toBe('v1');
    expect(body).toEqual({
      method: 'POST',
      routePath: '/api/echo',
      publicPath: '/api/v1/echo',
      tenant: 'tenant-a',
      body: { ok: true },
    });
  });
});
