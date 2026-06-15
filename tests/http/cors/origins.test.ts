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
  test('uses wildcard Access-Control-Allow-Origin by default', async () => {
    delete process.env.ARRA_CORS_ORIGINS;

    const res = await request('/api/ping', { headers: { origin: 'https://any.example' } });

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
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

  test('answers preflight OPTIONS with allowed methods and requested headers', async () => {
    process.env.ARRA_CORS_ORIGINS = 'https://studio.example';

    const res = await request('/api/ping', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,x-test',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://studio.example');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('authorization,x-test');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });
});
