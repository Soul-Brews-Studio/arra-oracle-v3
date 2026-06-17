import { afterEach, describe, expect, test } from 'bun:test';
import { handleStudioRequest, type StudioEnv } from '../../workers/studio/worker.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function env(overrides: Partial<StudioEnv> = {}): StudioEnv {
  return {
    ASSETS: { fetch: async () => new Response('<html>studio</html>', { headers: { 'content-type': 'text/html' } }) },
    ORACLE_URL: 'https://oracle.example/root/',
    ...overrides,
  };
}

describe('studio Cloudflare Worker API proxy edge cases', () => {
  test('proxies /api/* requests to ORACLE_URL without caching', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('x-oracle-studio-worker')).toBe('oracle-studio-worker');
      return Response.json({ ok: true });
    }) as typeof fetch;

    const response = await handleStudioRequest(new Request('https://studio.example/api/health?probe=1'), env());

    expect(seen).toEqual(['https://oracle.example/root/api/health?probe=1']);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-oracle-studio-worker')).toBe('oracle-studio-worker');
    expect(await response.json()).toEqual({ ok: true });
  });

  test('prefers ORACLE_ORIGIN_URL secret over legacy ORACLE_URL', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return Response.json({ ok: true });
    }) as typeof fetch;

    const response = await handleStudioRequest(new Request('https://studio.example/api/health'), env({
      ORACLE_ORIGIN_URL: 'https://origin.example/root/',
      ORACLE_URL: 'https://legacy.example',
    }));

    expect(response.status).toBe(200);
    expect(seen).toEqual(['https://origin.example/root/api/health']);
  });

  test('preserves method, body, and content headers for API writes', async () => {
    const seen: Array<{ body: string; contentType: string | null; method: string }> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = new Request('https://oracle.example/api/learn', init);
      seen.push({
        body: await upstream.text(),
        contentType: upstream.headers.get('content-type'),
        method: upstream.method,
      });
      return Response.json({ learned: true }, { status: 201 });
    }) as typeof fetch;

    const response = await handleStudioRequest(new Request('https://studio.example/api/learn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'studio.example' },
      body: JSON.stringify({ pattern: 'deploy' }),
    }), env({ ORACLE_URL: 'https://oracle.example' }));

    expect(response.status).toBe(201);
    expect(seen).toEqual([{ method: 'POST', contentType: 'application/json', body: '{"pattern":"deploy"}' }]);
  });

  test('strips spoofable proxy headers before forwarding API requests', async () => {
    const seen: Headers[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return Response.json({ ok: true });
    }) as typeof fetch;

    await handleStudioRequest(new Request('https://studio.example/api/search', {
      headers: {
        host: 'evil.example',
        connection: 'upgrade',
        'cf-connecting-ip': '203.0.113.10',
        'x-forwarded-for': '203.0.113.11',
      },
    }), env());

    expect(seen[0].get('host')).toBeNull();
    expect(seen[0].get('connection')).toBeNull();
    expect(seen[0].get('cf-connecting-ip')).toBeNull();
    expect(seen[0].get('x-forwarded-for')).toBeNull();
  });

  test('returns a no-store proxy error when ORACLE_URL is not configured', async () => {
    globalThis.fetch = (async () => { throw new Error('should not fetch upstream'); }) as typeof fetch;

    const response = await handleStudioRequest(new Request('https://studio.example/api/search'), env({ ORACLE_URL: undefined }));

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: 'api proxy failed' });
  });

  test('serves static assets with ui-oracle style cache policy', async () => {
    const html = await handleStudioRequest(new Request('https://studio.example/dashboard'), env());
    const js = await handleStudioRequest(new Request('https://studio.example/assets/index-AbCdEf123.js'), env({
      ASSETS: { fetch: async () => new Response('console.log("ok")', { headers: { 'content-type': 'text/javascript' } }) },
    }));

    expect(html.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.headers.get('x-oracle-studio-worker')).toBe('oracle-studio-worker');
  });
});
