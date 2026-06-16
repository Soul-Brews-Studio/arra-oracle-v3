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


  test('renders hot-swap picker with selected plugin state', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/planets'));
    const html = await response.text();

    expect(html).toContain('aria-label="Hot-swap canvas plugin"');
    expect(html).toContain('<option value="planets" selected>Planets · react</option>');
    expect(html).toContain('data-plugin-link="planets" aria-current="page"');
    expect(html).toContain('history.pushState');
  });


  test('renders localStorage and IndexedDB registry cache hooks', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/?plugin=wave'));
    const html = await response.text();

    expect(html).toContain('oracle.canvas.registry.v1');
    expect(html).toContain('localStorage.setItem');
    expect(html).toContain('indexedDB.open');
    expect(html).toContain("fetch('/api/canvas/registry')");
  });

  test('falls back to wave for unknown plugins', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/?plugin=unknown'));
    expect(await response.text()).toContain('plugin=wave');
  });


  test('serves worker-native health for custom domain monitoring', async () => {
    globalThis.fetch = (async () => { throw new Error('health should not proxy'); }) as typeof fetch;

    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/__health'),
      { ORACLE_API_BASE: 'https://oracle.example.test' },
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(body).toMatchObject({ ok: true, app: 'ui-canvas-oracle-studio', apiBase: 'https://oracle.example.test' });
    expect(Number(body.pluginCount)).toBeGreaterThanOrEqual(9);
  });

  test('handles api preflight without upstream fetch', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/api/health', { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('serves local canvas registry without upstream fetch', async () => {
    globalThis.fetch = (async () => {
      throw new Error('registry should not proxy');
    }) as typeof fetch;

    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/api/canvas/registry'));
    const body = await response.json() as { count: number; standalone: { host: string } };

    expect(response.status).toBe(200);
    expect(body.count).toBeGreaterThanOrEqual(3);
    expect(body.standalone.host).toBe('canvas.buildwithoracle.com');
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
