import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createCorsMiddleware } from '../../../src/middleware/cors.ts';

const previousOrigins = process.env.ARRA_CORS_ORIGINS;

afterEach(() => {
  if (previousOrigins === undefined) delete process.env.ARRA_CORS_ORIGINS;
  else process.env.ARRA_CORS_ORIGINS = previousOrigins;
});

function app() {
  return new Elysia()
    .use(createCorsMiddleware())
    .get('/api/ping', () => ({ ok: true }))
    .post('/api/ping', () => ({ ok: true }));
}

function request(path: string, init?: RequestInit) {
  return app().handle(new Request(`http://local${path}`, init));
}

describe('CORS middleware origins', () => {
  test('uses explicit local development origins by default', async () => {
    delete process.env.ARRA_CORS_ORIGINS;

    const allowed = await request('/api/ping', { headers: { origin: 'http://localhost:3000' } });
    const denied = await request('/api/ping', { headers: { origin: 'https://any.example' } });

    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(allowed.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  test('reflects configured origins and rejects unlisted origins', async () => {
    process.env.ARRA_CORS_ORIGINS = 'https://studio.example, https://admin.example';

    const allowed = await request('/api/ping', { headers: { origin: 'https://studio.example' } });
    const denied = await request('/api/ping', { headers: { origin: 'https://evil.example' } });

    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');
    expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(allowed.headers.get('Vary')).toContain('Origin');
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  test('normalizes configured origins and drops invalid entries', async () => {
    process.env.ARRA_CORS_ORIGINS = ' https://studio.example/path , not-a-url, ftp://bad.example, * ';

    const allowed = await request('/api/ping', { headers: { origin: 'https://studio.example' } });
    const denied = await request('/api/ping', { headers: { origin: 'https://bad.example' } });

    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  test('rejects wildcard configured origins', async () => {
    process.env.ARRA_CORS_ORIGINS = '*';

    const res = await request('/api/ping', { headers: { origin: 'https://studio.example' } });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  test('answers preflight OPTIONS with restricted methods and headers', async () => {
    process.env.ARRA_CORS_ORIGINS = 'https://studio.example';

    const res = await request('/api/ping', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('authorization,content-type');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  test('allows tenant and API key auth headers in preflight requests', async () => {
    process.env.ARRA_CORS_ORIGINS = 'https://studio.example';

    const res = await request('/api/ping', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Oracle-Tenant, X-Oracle-Tenant-Token, X-API-Key, X-Org-Id',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');
    expect(res.headers.get('Access-Control-Allow-Headers'))
      .toBe('x-oracle-tenant,x-oracle-tenant-token,x-api-key,x-org-id');
  });

  test('denies preflight for disallowed methods or headers', async () => {
    process.env.ARRA_CORS_ORIGINS = 'https://studio.example';

    const trace = await request('/api/ping', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example',
        'access-control-request-method': 'TRACE',
      },
    });
    const unsafeHeader = await request('/api/ping', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,x-unsafe',
      },
    });

    expect(trace.status).toBe(204);
    expect(trace.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(unsafeHeader.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
