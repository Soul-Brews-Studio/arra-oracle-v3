import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { handleStudioRequest, type StudioEnv } from '../../workers/studio/worker.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function env(overrides: Partial<StudioEnv> = {}): StudioEnv {
  return {
    ORACLE_URL: 'https://oracle.example.test/root/',
    ASSETS: {
      fetch: async (request) => new Response(`<html>${new URL(request.url).pathname}</html>`, {
        headers: { 'content-type': 'text/html' },
      }),
    },
    ...overrides,
  };
}

describe('Oracle Studio Worker static assets proxy', () => {
  test('wrangler config uses Workers Static Assets with worker-first routing', () => {
    const config = JSON.parse(readFileSync('workers/studio/wrangler.jsonc', 'utf8'));

    expect(config.main).toBe('worker.ts');
    expect(config.assets).toMatchObject({
      directory: '../../frontend/dist',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    });
  });

  test('proxies /api requests to ORACLE_URL and preserves method/body/query', async () => {
    const seen: Array<{ url: string; method: string; host: string | null; marker: string | null; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = new Request(input, init);
      seen.push({
        url: String(input),
        method: upstream.method,
        host: upstream.headers.get('host'),
        marker: upstream.headers.get('x-oracle-studio-worker'),
        body: await upstream.text(),
      });
      return Response.json({ ok: true });
    }) as typeof fetch;

    const response = await handleStudioRequest(new Request('https://studio.example/api/search?q=vector', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'spoofed.example' },
      body: JSON.stringify({ limit: 3 }),
    }), env());

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-oracle-studio-worker')).toBe('oracle-studio-worker');
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toEqual([{
      url: 'https://oracle.example.test/root/api/search?q=vector',
      method: 'POST',
      host: null,
      marker: 'oracle-studio-worker',
      body: '{"limit":3}',
    }]);
  });

  test('serves non-api requests through the ASSETS binding with SPA cache headers', async () => {
    const requested: string[] = [];
    const response = await handleStudioRequest(new Request('https://studio.example/dashboard'), env({
      ASSETS: { fetch: async (request) => { requested.push(request.url); return new Response('<html>studio</html>', { headers: { 'content-type': 'text/html' } }); } },
    }));

    expect(requested).toEqual(['https://studio.example/dashboard']);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
    expect(await response.text()).toBe('<html>studio</html>');
  });

  test('sets immutable cache headers for Vite asset URLs', async () => {
    const response = await handleStudioRequest(new Request('https://studio.example/assets/app.js'), env({
      ASSETS: { fetch: async () => new Response('console.log(1)', { headers: { 'content-type': 'text/javascript' } }) },
    }));

    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toBe('console.log(1)');
  });

  test('api preflight stays worker-local', async () => {
    globalThis.fetch = (async () => { throw new Error('preflight should not proxy'); }) as typeof fetch;

    const response = await handleStudioRequest(new Request('https://studio.example/api/search', { method: 'OPTIONS' }), env());

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('x-oracle-studio-worker')).toBe('oracle-studio-worker');
  });
});
