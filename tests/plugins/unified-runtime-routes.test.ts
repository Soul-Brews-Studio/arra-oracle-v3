import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { loadUnifiedPlugins } from '../../src/plugins/unified-loader.ts';
import { createUnifiedPluginRouteMount, createUnifiedRuntimeRef } from '../../src/plugins/runtime-routes.ts';
import { createNotFoundMiddleware } from '../../src/middleware/not-found.ts';
import { pluginDir } from './_fixtures.ts';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'arra-runtime-routes-'));
  temps.push(dir);
  return dir;
}

function writeApiPlugin(base: string, name: string, paths = [`/api/${name}/hello`]) {
  return pluginDir(base, name, {
    apiRoutes: paths.map((path) => ({ path, methods: ['GET'], handler: 'hello' })),
  }, `export function hello(ctx) { return { ok: true, body: { plugin: ctx.plugin } }; }\n`);
}

function setPluginEnabled(dir: string, enabled: boolean) {
  const path = join(dir, 'plugin.json');
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...json, enabled }, null, 2));
}

function appFor(ref: ReturnType<typeof createUnifiedRuntimeRef>) {
  const app = new Elysia().get('/api/core', () => ({ source: 'core' }));
  app.use(createUnifiedPluginRouteMount(ref, { localRoutes: () => app.routes }));
  app.use(createNotFoundMiddleware(() => app.routes));
  return app;
}

async function getJson(app: Elysia, path: string, method = 'GET') {
  const response = await app.handle(new Request(`http://local${path}`, { method }));
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

describe('unified plugin runtime routes', () => {
  test('reads a swapped runtimeRef through one stable Elysia mount', async () => {
    const a = tmp();
    const b = tmp();
    writeApiPlugin(a, 'alpha');
    writeApiPlugin(b, 'beta', ['/api/beta/hello', '/api/core']);
    const runtimeA = await loadUnifiedPlugins({ dirs: [a] });
    const runtimeB = await loadUnifiedPlugins({ dirs: [b] });
    const ref = createUnifiedRuntimeRef(runtimeA);
    const app = appFor(ref);

    expect((await getJson(app, '/api/alpha/hello')).body).toEqual({ plugin: 'alpha' });
    expect((await getJson(app, '/api/beta/hello')).response.status).toBe(404);

    ref.current = runtimeB;
    expect((await getJson(app, '/api/alpha/hello')).response.status).toBe(404);
    expect((await getJson(app, '/api/beta/hello')).body).toEqual({ plugin: 'beta' });
    expect((await getJson(app, '/api/core')).body).toEqual({ source: 'core' });

    const wrongMethod = await getJson(app, '/api/beta/hello', 'POST');
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.get('allow')).toContain('GET');
  });

  test('uses runtime.reload route mutations without remounting the app', async () => {
    const root = tmp();
    const dir = writeApiPlugin(root, 'toggle-route');
    const runtime = await loadUnifiedPlugins({ dirs: [root] });
    const app = appFor(createUnifiedRuntimeRef(runtime));

    expect((await getJson(app, '/api/toggle-route/hello')).body).toEqual({ plugin: 'toggle-route' });
    setPluginEnabled(dir, false);
    await runtime.reload();
    expect((await getJson(app, '/api/toggle-route/hello')).response.status).toBe(404);

    setPluginEnabled(dir, true);
    await runtime.reload();
    expect((await getJson(app, '/api/toggle-route/hello')).body).toEqual({ plugin: 'toggle-route' });
  });
});
