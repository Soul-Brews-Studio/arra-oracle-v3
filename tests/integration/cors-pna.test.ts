import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createCorsMiddleware, createPrivateNetworkPreflightMiddleware, parseCorsOrigins } from '../../src/middleware/cors.ts';

const HOSTED_STUDIO = 'https://god.buildwithoracle.com';

function pnaPreflight(origin: string): Request {
  return new Request('http://localhost:47778/api/health', {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-private-network': 'true',
    },
  });
}

function corsApp() {
  return new Elysia()
    .use(createPrivateNetworkPreflightMiddleware())
    .use(createCorsMiddleware())
    .get('/api/health', () => ({ status: 'ok' }));
}

describe('hosted Studio CORS and PNA preflight', () => {
  test('default CORS origins include the hosted Studio domain', () => {
    expect(parseCorsOrigins().origins).toContain(HOSTED_STUDIO);
  });

  test('allows hosted Studio private-network preflight to local Oracle', async () => {
    const response = await corsApp().handle(pnaPreflight(HOSTED_STUDIO));

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(HOSTED_STUDIO);
    expect(response.headers.get('Access-Control-Allow-Private-Network')).toBe('true');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(response.headers.get('Vary')).toContain('Origin');
  });

  test('does not grant private-network access to unknown origins', async () => {
    const response = await corsApp().handle(pnaPreflight('https://evil.example'));

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Private-Network')).toBeNull();
  });
});
