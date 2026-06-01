import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Elysia } from 'elysia';

import {
  disabledPluginsFromEnv,
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

async function appWithDisabled(disabledPlugins: string[]) {
  const { createBuiltinServerPlugins } = await import('../plugin/builtin.ts');
  const loaded = loadServerPlugins(await createBuiltinServerPlugins({ dataDir: tmp }), {
    disabledPlugins,
  });
  const enabled = enabledServerPlugins(loaded);
  const app = new Elysia();
  for (const routes of serverPluginRoutes(enabled)) app.use(routes as any);
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

  test('FED_ENABLED=false maps to the federation plugin disable switch', () => {
    withEnv('FED_ENABLED', 'false', () => {
      expect(disabledPluginsFromEnv()).toContain('federation');
    });
  });

  test('federation plugin can be removed and restored around core routes', async () => {
    const disabled = await appWithDisabled(['federation']);
    expect(disabled.enabled.some((plugin) => plugin.name === 'federation')).toBe(false);
    expect((await disabled.app.handle(new Request('http://local/info'))).status).toBe(404);
    expect((await disabled.app.handle(new Request('http://local/api/identity'))).status).toBe(404);
    expect((await disabled.app.handle(new Request('http://local/api/health'))).status).toBe(200);

    const restored = await appWithDisabled([]);
    expect(restored.enabled.some((plugin) => plugin.name === 'federation')).toBe(true);
    expect((await restored.app.handle(new Request('http://local/info'))).status).toBe(200);
    expect((await restored.app.handle(new Request('http://local/api/identity'))).status).toBe(200);
  });

  test('disable everything still serves core search, learn, and stats over FTS5', async () => {
    const { app, enabled } = await appWithDisabled(['*']);
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
