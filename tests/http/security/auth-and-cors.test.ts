import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createCorsMiddleware, createPrivateNetworkPreflightMiddleware } from '../../../src/middleware/cors.ts';
import { isApiAuthorized, isApiPathProtected } from '../../../src/server/api-token-auth.ts';

const previousApiToken = process.env.ARRA_API_TOKEN;
const previousCorsOrigins = process.env.ARRA_CORS_ORIGINS;

function restoreEnv() {
  if (previousApiToken === undefined) delete process.env.ARRA_API_TOKEN;
  else process.env.ARRA_API_TOKEN = previousApiToken;
  if (previousCorsOrigins === undefined) delete process.env.ARRA_CORS_ORIGINS;
  else process.env.ARRA_CORS_ORIGINS = previousCorsOrigins;
}

function corsApp() {
  return new Elysia()
    .use(createPrivateNetworkPreflightMiddleware())
    .use(createCorsMiddleware())
    .get('/api/ping', () => ({ ok: true }));
}

describe('HTTP auth and CORS security contracts', () => {
  test('ARRA_API_TOKEN requires bearer auth and rejects URL query tokens', () => {
    process.env.ARRA_API_TOKEN = 'secret';
    try {
      const queryToken = new Request('http://local/api/search?token=secret');
      const bearer = new Request('http://local/api/search', {
        headers: { authorization: 'Bearer secret' },
      });
      expect(isApiAuthorized(queryToken)).toBe(false);
      expect(isApiAuthorized(bearer)).toBe(true);
    } finally {
      restoreEnv();
    }
  });

  test('open API auth bypasses match exact paths or child paths only', () => {
    expect(isApiPathProtected('/api/health')).toBe(false);
    expect(isApiPathProtected('/api/health/deep')).toBe(false);
    expect(isApiPathProtected('/api/healthz')).toBe(true);
    expect(isApiPathProtected('/api/docs')).toBe(false);
    expect(isApiPathProtected('/api/docs/json')).toBe(false);
    expect(isApiPathProtected('/api/docs-malicious')).toBe(true);
  });

  test('private-network preflight does not grant disallowed origins', async () => {
    process.env.ARRA_CORS_ORIGINS = 'https://studio.example';
    try {
      const res = await corsApp().handle(new Request('http://local/api/ping', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'GET',
          'access-control-request-private-network': 'true',
        },
      }));
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Private-Network')).toBeNull();
    } finally {
      restoreEnv();
    }
  });
});
