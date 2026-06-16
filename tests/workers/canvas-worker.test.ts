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
    expect(html).toContain('data-studio-home aria-label="Open Oracle Studio home"');
    expect(html).toContain('href="https://studio.buildwithoracle.com/"');
    expect(html).toContain('history.pushState');
  });

  test('wires react canvas plugins to their Oracle data API', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/map'));
    const html = await response.text();

    expect(html).toContain('"apiPath":"/api/map3d"');
    expect(html).toContain('loadPluginData');
    expect(html).toContain('fetch(meta.apiPath');
    expect(html).toContain('dataset.dataCount');
    expect(html).toContain('dataCount()');
  });


  test('renders localStorage and IndexedDB registry cache hooks', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/?plugin=wave'));
    const html = await response.text();

    expect(html).toContain('oracle.canvas.registry.v1');
    expect(html).toContain('localStorage.getItem');
    expect(html).toContain('localStorage.setItem');
    expect(html).toContain('indexedDB.open');
    expect(html).toContain("objectStore('kv').get");
    expect(html).toContain('normalizeRegistry');
    expect(html).toContain('registry cache ready');
    expect(html).toContain('registry updated');
    expect(html).toContain("fetch('/api/plugins?kind=canvas')");
    expect(html).toContain('loadRegistry()');
  });

  test('falls back to wave for unknown plugins with a visible notice', async () => {
    const response = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/?plugin=unknown'));
    const html = await response.text();

    expect(html).toContain('plugin=wave');
    expect(html).toContain('data-requested-plugin="unknown"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Unknown canvas plugin');
    expect(html).toContain('loaded Wave instead');
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
    const metadata = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/api/plugins?kind=canvas'));
    const metadataBody = await metadata.json() as { kind: string; plugins: Array<{ id: string; renderer: string }> };

    expect(response.status).toBe(200);
    expect(body.count).toBeGreaterThanOrEqual(3);
    expect(body.standalone.host).toBe('canvas.buildwithoracle.com');
    expect(metadata.status).toBe(200);
    expect(metadataBody.kind).toBe('canvas');
    expect(metadataBody.plugins).toContainEqual(expect.objectContaining({ id: 'wave', renderer: 'Three' }));
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

  test('preserves proxied api method, body, and content headers', async () => {
    const seen: Array<{ url: string; method: string; contentType: string | null; body: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = new Request(input, init);
      seen.push({
        url: String(input),
        method: upstream.method,
        contentType: upstream.headers.get('content-type'),
        body: await upstream.text(),
      });
      return Response.json({ ok: true });
    }) as typeof fetch;

    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/canvas-state?plugin=map', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selected: 'map' }),
      }),
      { ORACLE_API_BASE: 'https://oracle.example.test' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(seen).toEqual([{
      url: 'https://oracle.example.test/api/canvas-state?plugin=map',
      method: 'POST',
      contentType: 'application/json',
      body: '{"selected":"map"}',
    }]);
  });
});
