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
import { discoverUnifiedManifestPlugins } from '../plugin/unified.ts';
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

  test('federation capability provider is opt-in and registers mesh nodes', async () => {
    const disabled = await appWithConfig([]);
    expect(disabled.enabled.some((plugin) => plugin.name === 'federation')).toBe(false);
    expect((await disabled.app.handle(new Request('http://local/api/federation/status'))).status).toBe(404);

    const { app, enabled } = await appWithConfig([], ['federation']);
    expect(enabled.some((plugin) => plugin.name === 'federation')).toBe(true);
    const status = await app.handle(new Request('http://local/api/federation/status'));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      ok: true,
      provider: 'arra-oracle-federation',
      activeNodes: 1,
    });

    const registered = await app.handle(new Request('http://local/api/federation/mesh/nodes/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'mesh-relay',
        url: 'https://relay.example.test',
        capabilities: ['maw:hey', 'maw:peek'],
      }),
    }));
    expect(registered.status).toBe(200);
    expect(await registered.json()).toMatchObject({ success: true, node: { id: 'mesh-relay' } });
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

  test('skips unified manifest entries that escape plugin directory', async () => {
    const userDir = join(tmp, 'unified-server-escape');
    const pluginDir = join(userDir, 'bad-entry');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(userDir, 'outside.ts'), 'export default () => ({ ok: true });\n');
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'bad-entry',
      version: '1.0.0',
      entry: '../outside.ts',
      sdk: '^0.0.1',
      api: { path: '/api/bad-entry', methods: ['GET'] },
    }));

    const warn = console.warn;
    console.warn = () => {};
    try {
      const plugins = await discoverUnifiedManifestPlugins({
        userDir,
        bundledDir: join(tmp, 'missing-bundled-server'),
      });
      expect(plugins).toEqual([]);
    } finally {
      console.warn = warn;
    }
  });
});
