import { afterEach, describe, expect, test } from 'bun:test';
import { handleCanvasRequest } from '../../src/workers/canvas/index.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('canvas Cloudflare Worker', () => {
  test('renders selected canvas plugins from query and path', async () => {
    const wave = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/?plugin=wave'));
    const planets = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/planets'));
    const cube = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/cube'));

    expect(wave.status).toBe(200);
    expect(wave.headers.get('content-type')).toContain('text/html');
    expect(await wave.text()).toContain('plugin=wave');
    expect(await planets.text()).toContain('plugin=planets');
    expect(await cube.text()).toContain('plugin=cube');
  });

  test('falls back to wave for unknown plugins', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/?plugin=unknown'));
    expect(await response.text()).toContain('plugin=wave');
  });

  test('handles api preflight without upstream fetch', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/api/health', { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('proxies api requests to configured oracle backend without caching', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      expect(new Headers(init?.headers).get('x-oracle-canvas-worker')).toBe('canvas.buildwithoracle.com');
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/health?probe=1'),
      { ORACLE_API_BASE: 'https://oracle.example.test/root/' },
    );

    expect(seen).toEqual(['https://oracle.example.test/api/health?probe=1']);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });
});
