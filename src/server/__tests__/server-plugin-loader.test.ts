import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Elysia } from 'elysia';

import {
  disabledPluginsFromEnv,
  enabledPluginsFromEnv,
  enabledServerPlugins,
  loadServerPlugins,
  serverPluginRoutes,
} from '../plugin/loader.ts';
import type { ServerPlugin } from '../plugin/types.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-server-plugin-loader-'));
process.env.ORACLE_DATA_DIR = tmp;
process.env.ORACLE_DB_PATH = join(tmp, 'oracle.db');
process.env.ORACLE_REPO_ROOT = tmp;
process.env.ORACLE_PORT = '0';
process.env.VECTOR_URL = '';

async function appWithConfig(disabledPlugins: string[], enabledPlugins: string[] = []) {
  const { createBuiltinServerPlugins } = await import('../plugin/builtin.ts');
  const loaded = loadServerPlugins(await createBuiltinServerPlugins({ dataDir: tmp }), {
    disabledPlugins,
    enabledPlugins,
  });
  const enabled = enabledServerPlugins(loaded);
  const app = new Elysia();
  for (const routes of serverPluginRoutes(enabled)) app.use(routes as any);
  return { app, enabled };
}

function appFromPlugins(plugins: ServerPlugin[], warn?: (message: string) => void) {
  const enabled = enabledServerPlugins(loadServerPlugins(plugins, { enabledPlugins: ['*'] }));
  const app = new Elysia();
  for (const routes of serverPluginRoutes(enabled, { warn })) app.use(routes as any);
  return { app, enabled };
}

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

afterAll(async () => {
  const { closeDb } = await import('../../db/index.ts');
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('server plugin loader', () => {
  test('refuses explicit core plugin disable', () => {
    const plugins: ServerPlugin[] = [
      { name: 'search', tier: 'core' },
      { name: 'federation', tier: 'standard' },
    ];
    expect(() => loadServerPlugins(plugins, { disabledPlugins: ['search'] })).toThrow(
      'Cannot disable core server plugin "search"',
    );
  });

  test('wildcard disable removes standard/extra while keeping core', () => {
    const plugins: ServerPlugin[] = [
      { name: 'search', tier: 'core' },
      { name: 'federation', tier: 'standard' },
      { name: 'obsidian', tier: 'extra' },
    ];
    const enabled = enabledServerPlugins(loadServerPlugins(plugins, { disabledPlugins: ['*'] }));
    expect(enabled.map((plugin) => plugin.name)).toEqual(['search']);
  });

  test('FED_ENABLED=true maps to the federation plugin enable switch', () => {
    withEnv('FED_ENABLED', 'true', () => {
      expect(enabledPluginsFromEnv()).toContain('federation');
      expect(disabledPluginsFromEnv()).not.toContain('federation');
    });
  });

  test('ORACLE_ENABLED_PLUGINS can opt federation in', () => {
    withEnv('ORACLE_ENABLED_PLUGINS', 'federation', () => {
      expect(enabledPluginsFromEnv()).toContain('federation');
    });
  });

  test('federation plugin is off by default and opt-in around core routes', async () => {
    const disabled = await appWithConfig([]);
    expect(disabled.enabled.some((plugin) => plugin.name === 'federation')).toBe(false);
    expect((await disabled.app.handle(new Request('http://local/info'))).status).toBe(404);
    expect((await disabled.app.handle(new Request('http://local/api/identity'))).status).toBe(404);
    expect((await disabled.app.handle(new Request('http://local/api/health'))).status).toBe(200);

    const restored = await appWithConfig([], ['federation']);
    expect(restored.enabled.some((plugin) => plugin.name === 'federation')).toBe(true);
    expect((await restored.app.handle(new Request('http://local/info'))).status).toBe(200);
    expect((await restored.app.handle(new Request('http://local/api/identity'))).status).toBe(200);
  });

  test('ORACLE_DISABLED_PLUGINS still wins over explicit federation enable', async () => {
    const conflicted = await appWithConfig(['federation'], ['federation']);
    expect(conflicted.enabled.some((plugin) => plugin.name === 'federation')).toBe(false);
    expect((await conflicted.app.handle(new Request('http://local/info'))).status).toBe(404);
    expect((await conflicted.app.handle(new Request('http://local/api/health'))).status).toBe(200);
  });

  test('api manifest mounts a built-in example plugin under its declared path', async () => {
    const { app, enabled } = await appWithConfig([], ['plugin-api-example']);
    expect(enabled.some((plugin) => plugin.name === 'plugin-api-example')).toBe(true);

    const response = await app.handle(new Request('http://local/api/plugin-example'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      plugin: 'plugin-api-example',
      mountedBy: 'server-plugin-api-manifest',
    });
  });

  test('direct route wins over api manifest route collision', async () => {
    const warnings: string[] = [];
    const { app } = appFromPlugins([
      {
        name: 'direct-conflict',
        tier: 'standard',
        routes: () => new Elysia().get('/api/plugin-conflict', () => ({ source: 'direct' })),
      },
      {
        name: 'manifest-conflict',
        tier: 'extra',
        enabled: false,
        api: { path: '/api/plugin-conflict', methods: ['GET'] },
        routes: () => new Elysia().get('/', () => ({ source: 'manifest' })),
      },
    ], (message) => warnings.push(message));

    const response = await app.handle(new Request('http://local/api/plugin-conflict'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source: 'direct' });
    expect(warnings.some((message) => message.includes('direct route wins'))).toBe(true);
    expect(warnings.some((message) => message.includes('manifest-conflict'))).toBe(true);
  });

  test('disable everything still serves core search, learn, and stats over FTS5', async () => {
    const { app, enabled } = await appWithConfig(['*']);
    expect(enabled.every((plugin) => plugin.tier === 'core')).toBe(true);

    const pattern = 'server plugin core floor acceptance';
    const learn = await app.handle(new Request('http://local/api/learn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern, source: 'test', concepts: ['plugin-core'] }),
    }));
    expect(learn.status).toBe(200);

    const stats = await app.handle(new Request('http://local/api/stats'));
    expect(stats.status).toBe(200);
    const statsBody = await stats.json() as { total?: number };
    expect(statsBody.total ?? 0).toBeGreaterThanOrEqual(1);

    const search = await app.handle(new Request(`http://local/api/search?q=${encodeURIComponent(pattern)}&mode=fts`));
    expect(search.status).toBe(200);
    const searchBody = await search.json() as { total?: number };
    expect(searchBody.total ?? 0).toBeGreaterThanOrEqual(1);
  });
});
