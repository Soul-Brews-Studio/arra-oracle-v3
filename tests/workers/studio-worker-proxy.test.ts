import { describe, expect, test } from 'bun:test';
import { handleStudioRequest, type StudioWorkerEnv } from '../../workers/studio/worker.ts';

function assets(body = '<html>studio</html>'): StudioWorkerEnv['ASSETS'] {
  return {
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/html' } }),
  };
}

describe('studio Cloudflare Worker API proxy', () => {
  test('proxies /api/* requests to ORACLE_URL without caching', async () => {
    const seen: string[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('x-oracle-studio-worker')).toBe('arra-oracle-studio');
      return Response.json({ ok: true });
    };

    const response = await handleStudioRequest(
      new Request('https://studio.example/api/health?probe=1'),
      { ASSETS: assets(), ORACLE_URL: 'https://oracle.example/root/' },
      fetcher,
    );

    expect(seen).toEqual(['https://oracle.example/root/api/health?probe=1']);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-oracle-studio-worker')).toBe('arra-oracle-studio');
    expect(await response.json()).toEqual({ ok: true });
  });

  test('preserves method, body, and content headers for API writes', async () => {
    const seen: Array<{ body: string; contentType: string | null; method: string }> = [];
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = new Request('https://oracle.example/api/learn', init);
      seen.push({
        body: await upstream.text(),
        contentType: upstream.headers.get('content-type'),
        method: upstream.method,
      });
      return Response.json({ learned: true }, { status: 201 });
    };

    const response = await handleStudioRequest(
      new Request('https://studio.example/api/learn', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'studio.example' },
        body: JSON.stringify({ pattern: 'deploy' }),
      }),
      { ASSETS: assets(), ORACLE_URL: 'https://oracle.example' },
      fetcher,
    );

    expect(response.status).toBe(201);
    expect(seen).toEqual([{ method: 'POST', contentType: 'application/json', body: '{"pattern":"deploy"}' }]);
  });

  test('returns a no-store error when ORACLE_URL is not configured', async () => {
    const response = await handleStudioRequest(
      new Request('https://studio.example/api/search'),
      { ASSETS: assets() },
      async () => { throw new Error('should not fetch upstream'); },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: 'oracle_url_required' });
  });

  test('serves static assets with ui-oracle style cache policy', async () => {
    const html = await handleStudioRequest(new Request('https://studio.example/dashboard'), { ASSETS: assets() });
    const js = await handleStudioRequest(new Request('https://studio.example/assets/index-AbCdEf123.js'), {
      ASSETS: assets('console.log("ok")'),
    });

    expect(html.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.headers.get('x-oracle-studio-worker')).toBe('arra-oracle-studio');
  });
});
