import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiKeyAuthMiddleware } from '../../../src/middleware/auth.ts';

const previousApiKey = process.env.ARRA_API_KEY;

afterEach(() => {
  if (previousApiKey === undefined) delete process.env.ARRA_API_KEY;
  else process.env.ARRA_API_KEY = previousApiKey;
});

function app() {
  return new Elysia()
    .use(createApiKeyAuthMiddleware())
    .get('/api/health', () => ({ status: 'ok' }))
    .get('/api/search', () => ({ ok: true }))
    .get('/', () => ({ ok: true }));
}

async function get(path: string, key?: string) {
  const headers = key ? { authorization: `Bearer ${key}` } : undefined;
  return app().handle(new Request(`http://local${path}`, { headers }));
}

describe('ARRA_API_KEY auth middleware', () => {
  test('skips auth entirely when no API key is configured', async () => {
    delete process.env.ARRA_API_KEY;

    expect((await get('/api/search')).status).toBe(200);
    expect((await get('/')).status).toBe(200);
  });

  test('requires a matching bearer token when API key is configured', async () => {
    process.env.ARRA_API_KEY = 'secret';

    const missing = await get('/api/search');
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({
      error: 'api_key_auth_required',
      code: 401,
      details: { reason: 'missing' },
    });

    const invalid = await get('/api/search', 'wrong');
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({
      error: 'api_key_auth_required',
      code: 401,
      details: { reason: 'invalid' },
    });

    expect((await get('/api/search', 'secret')).status).toBe(200);
    expect((await get('/', 'secret')).status).toBe(200);
  });

  test('bypasses API key auth for /api/health', async () => {
    process.env.ARRA_API_KEY = 'secret';

    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
