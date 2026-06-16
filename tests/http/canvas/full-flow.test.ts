import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createCanvasStandaloneApp } from '../../../src/canvas/standalone.ts';
import { listCanvasPlugins } from '../../../src/canvas/plugins.ts';
import { handleCanvasRequest } from '../../../src/workers/canvas/index.ts';

const HOST = 'https://canvas.buildwithoracle.com';
const PLUGIN_IDS = listCanvasPlugins().map((plugin) => plugin.id);

function canonicalPath(id: string): string {
  return id === 'map' || id === 'planets' ? `/${id}` : `/?plugin=${id}`;
}

async function workerJson(path: string) {
  const res = await handleCanvasRequest(new Request(`${HOST}${path}`));
  return { res, body: await res.json() as Record<string, any> };
}

describe('canvas.buildwithoracle.com full integration flow', () => {
  test('subdomain worker renders every canvas plugin and keeps cache hooks', async () => {
    for (const id of PLUGIN_IDS) {
      const res = await handleCanvasRequest(new Request(`${HOST}/?plugin=${id}`));
      const html = await res.text();

      expect(res.status, id).toBe(200);
      expect(res.headers.get('content-type'), id).toContain('text/html');
      expect(res.headers.get('cache-control'), id).toContain('stale-while-revalidate');
      expect(html, id).toContain(`plugin=${id}`);
      expect(html, id).toContain('localStorage.setItem');
      expect(html, id).toContain('indexedDB.open');
      expect(html, id).toContain("fetch('/api/plugins?kind=canvas')");
    }
  });

  test('react plugins use clean standalone paths and three plugins keep query paths', async () => {
    const map = await handleCanvasRequest(new Request(`${HOST}/map`));
    expect(await map.text()).toContain('plugin=map');

    const planets = await handleCanvasRequest(new Request(`${HOST}/planets`));
    expect(await planets.text()).toContain('plugin=planets');

    const wave = await workerJson('/api/canvas/plugins/wave');
    const react = await workerJson('/api/canvas/plugins?kind=react');
    expect(wave.body.plugin).toMatchObject({ id: 'wave', standalonePath: '/?plugin=wave' });
    expect(react.body.plugins.map((plugin: { id: string }) => plugin.id)).toEqual(['map', 'planets']);
    expect(react.body.plugins.map((plugin: { standalonePath: string }) => plugin.standalonePath)).toEqual(['/map', '/planets']);
  });

  test('standalone registry route matches worker registry and can serve HTML fallback', async () => {
    const app = createCanvasStandaloneApp({ ORACLE_API_BASE: 'https://oracle.example.test' });
    const route = await app.handle(new Request('http://local/api/canvas/registry'));
    const metadata = await app.handle(new Request('http://local/api/plugins?kind=canvas'));
    const worker = await handleCanvasRequest(new Request(`${HOST}/api/canvas/registry`));
    const routeBody = await route.json() as { count: number; plugins: Array<{ id: string }> };
    const metadataBody = await metadata.json() as { kind: string; count: number; plugins: Array<{ id: string; renderer: string }> };
    const workerBody = await worker.json() as { count: number; plugins: Array<{ id: string }> };

    expect(route.status).toBe(200);
    expect(metadata.status).toBe(200);
    expect(routeBody.count).toBe(workerBody.count);
    expect(metadataBody.kind).toBe('canvas');
    expect(metadataBody.count).toBe(workerBody.count);
    expect(routeBody.plugins.map((plugin) => plugin.id)).toEqual(PLUGIN_IDS);

    const html = await app.handle(new Request('http://local/galaxy'));
    expect(await html.text()).toContain('plugin=galaxy');
  });

  test('worker proxies non-canvas API calls with no-store cache and canvas marker header', async () => {
    const oldFetch = globalThis.fetch;
    const calls: Array<{ url: string; marker: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push({ url: String(input), marker: request.headers.get('x-oracle-canvas-worker') });
      return Response.json({ ok: true, proxied: true }, { headers: { 'cache-control': 'public, max-age=999' } });
    }) as typeof fetch;
    try {
      const res = await handleCanvasRequest(new Request(`${HOST}/api/health`), { ORACLE_API_BASE: 'https://api.example.test' });
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(calls[0]).toEqual({ url: 'https://api.example.test/api/health', marker: 'canvas.buildwithoracle.com' });
      expect(await res.json()).toEqual({ ok: true, proxied: true });
    } finally {
      globalThis.fetch = oldFetch;
    }
  });


  test('acceptance URLs render directly while Studio canvas route metadata remains canonical', async () => {
    for (const id of ['wave', 'map', 'planets']) {
      const res = await handleCanvasRequest(new Request(`${HOST}/?plugin=${id}`));
      const html = await res.text();
      expect(res.status, id).toBe(200);
      expect(html, id).toContain(`plugin=${id}`);
      expect(html, id).toContain('aria-label="Hot-swap canvas plugin"');
      expect(html, id).toContain('canvas.buildwithoracle.com');
      expect(html, id).toContain(`rel="canonical" href="${HOST}${canonicalPath(id)}"`);
      expect(html, id).toContain(`property="og:url" content="${HOST}${canonicalPath(id)}"`);
    }
    const registry = await workerJson('/api/canvas/registry');
    expect(registry.body.standalone).toMatchObject({ host: 'canvas.buildwithoracle.com' });
    expect(registry.body.plugins.find((plugin: { id: string }) => plugin.id === 'wave').path).toBe('/canvas');
  });

  test('worker config keeps canvas custom domain running first', () => {
    const config = readFileSync('workers/canvas/wrangler.toml', 'utf8');
    expect(config).toContain('canvas.buildwithoracle.com');
    expect(config).toContain('custom_domain = true');
    expect(config).toContain('run_worker_first = true');
  });
});
