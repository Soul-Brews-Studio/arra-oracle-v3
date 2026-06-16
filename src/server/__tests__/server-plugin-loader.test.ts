import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
process.env.HOME = tmp;
process.env.XDG_CONFIG_HOME = join(tmp, 'xdg');

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

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try { fn(); }
  finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function writeGlobalConfig(config: unknown) {
  const dir = join(tmp, 'xdg', 'arra');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
}

afterEach(() => {
  rmSync(join(tmp, 'xdg'), { recursive: true, force: true });
});

describe('server plugin loader', () => {
  test('refuses explicit core plugin disable', () => {
    const plugins: ServerPlugin[] = [
      { name: 'search', tier: 'core' },
      { name: 'gateway', tier: 'standard' },
    ];
    expect(() => loadServerPlugins(plugins, { disabledPlugins: ['search'] })).toThrow(
      'Cannot disable core server plugin "search"',
    );
  });

  test('wildcard disable removes standard/extra while keeping core', () => {
    const plugins: ServerPlugin[] = [
      { name: 'search', tier: 'core' },
      { name: 'gateway', tier: 'standard' },
      { name: 'obsidian', tier: 'extra' },
    ];
    const enabled = enabledServerPlugins(loadServerPlugins(plugins, { disabledPlugins: ['*'] }));
    expect(enabled.map((plugin) => plugin.name)).toEqual(['search']);
  });

  test('ORACLE_ENABLED_PLUGINS can opt in an extra plugin', () => {
    withEnv('ORACLE_ENABLED_PLUGINS', 'plugin-api-example', () => {
      expect(enabledPluginsFromEnv()).toContain('plugin-api-example');
    });
  });

  test('config file can disable standard plugins and enable opt-in plugins', async () => {
    writeGlobalConfig({ disabledPlugins: ['gateway'], enabledPlugins: ['plugin-api-example'] });
    const { createBuiltinServerPlugins } = await import('../plugin/builtin.ts');
    const loaded = loadServerPlugins(await createBuiltinServerPlugins({ dataDir: tmp }), {
      disabledPlugins: disabledPluginsFromEnv(),
      enabledPlugins: enabledPluginsFromEnv(),
    });
    const enabled = enabledServerPlugins(loaded);
    expect(enabled.some((plugin) => plugin.name === 'gateway')).toBe(false);
    expect(enabled.some((plugin) => plugin.name === 'plugin-api-example')).toBe(true);
  });

  test('config file cannot disable core server plugins', async () => {
    writeGlobalConfig({ disabledPlugins: ['search'] });
    const { createBuiltinServerPlugins } = await import('../plugin/builtin.ts');
    const plugins = await createBuiltinServerPlugins({ dataDir: tmp });
    expect(() => loadServerPlugins(plugins, {
      disabledPlugins: disabledPluginsFromEnv(),
      enabledPlugins: enabledPluginsFromEnv(),
    })).toThrow('Cannot disable core server plugin "search"');
  });

  test('federation routes are not part of the builtin app surface', async () => {
    const { app, enabled } = await appWithConfig([], ['federation']);
    expect(enabled.some((plugin) => plugin.name === 'federation')).toBe(false);
    expect((await app.handle(new Request('http://local/info'))).status).toBe(404);
    expect((await app.handle(new Request('http://local/api/identity'))).status).toBe(404);
    expect((await app.handle(new Request('http://local/api/peers'))).status).toBe(404);
    expect((await app.handle(new Request('http://local/api/health'))).status).toBe(200);
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
});
