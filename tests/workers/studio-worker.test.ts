import { afterEach, describe, expect, test } from 'bun:test';
import studioWorker, { type Env } from '../../workers/studio/worker.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function env(assetResponse: Response, overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => assetResponse.clone() },
    ORACLE_URL: 'https://oracle.example.com',
    MCP_URL: 'https://mcp.example.com/mcp',
    ...overrides,
  };
}

describe('studio worker', () => {
  test('serves Vite assets with immutable cache headers', async () => {
    const res = await studioWorker.fetch(
      new Request('https://studio.example/assets/index-abcdef12.js'),
      env(new Response('js', { headers: { 'content-type': 'application/javascript' } })),
    );

    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  test('serves SPA HTML with stale-while-revalidate cache headers', async () => {
    const res = await studioWorker.fetch(
      new Request('https://studio.example/settings'),
      env(new Response('<html></html>', { headers: { 'content-type': 'text/html' } })),
    );

    expect(res.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
  });

  test('proxies /api requests to ORACLE_URL with optional bearer token', async () => {
    globalThis.fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(input);
      expect(req.url).toBe('https://oracle.example.com/api/search?q=memory');
      expect(req.headers.get('authorization')).toBe('Bearer secret-token');
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    };

    const res = await studioWorker.fetch(
      new Request('https://studio.example/api/search?q=memory'),
      env(new Response('unused'), { ARRA_API_TOKEN: 'secret-token' }),
    );

    expect(res.status).toBe(201);
  });

  test('proxies /mcp requests to MCP_URL without duplicating the mount path', async () => {
    globalThis.fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(input);
      expect(req.url).toBe('https://mcp.example.com/mcp?session=1');
      return new Response('mcp-ok');
    };

    const res = await studioWorker.fetch(
      new Request('https://studio.example/mcp?session=1'),
      env(new Response('unused')),
    );

    expect(await res.text()).toBe('mcp-ok');
  });

  test('returns no-store JSON when ORACLE_URL is still a placeholder', async () => {
    const res = await studioWorker.fetch(
      new Request('https://studio.example/api/search'),
      env(new Response('unused'), { ORACLE_URL: 'https://replace-with-your-oracle-backend.example.com' }),
    );
    const body = await res.json() as { error: string };

    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.error).toBe('ORACLE_URL is not configured');
  });
});
