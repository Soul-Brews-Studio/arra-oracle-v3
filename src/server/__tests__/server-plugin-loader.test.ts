import { describe, expect, test, afterAll, afterEach } from 'bun:test';
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
  try {
    fn();
  } finally {
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

afterAll(async () => {
  // Keep the shared db module open; other Bun test files reuse the same module
  // instance even under --isolate.
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

  test('config file can disable standard plugins and enable opt-in plugins', async () => {
    writeGlobalConfig({ disabledPlugins: ['gateway'], enabledPlugins: ['federation'] });
    const { createBuiltinServerPlugins } = await import('../plugin/builtin.ts');
    const loaded = loadServerPlugins(await createBuiltinServerPlugins({ dataDir: tmp }), {
      disabledPlugins: disabledPluginsFromEnv(),
      enabledPlugins: enabledPluginsFromEnv(),
    });
    const enabled = enabledServerPlugins(loaded);
    expect(enabled.some((plugin) => plugin.name === 'gateway')).toBe(false);
    expect(enabled.some((plugin) => plugin.name === 'federation')).toBe(true);
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

  test('dedicated federation plugin owns the peer route contract', async () => {
    const { createFederationPlugin } = await import('../plugin/federation.ts');
    const plugin = createFederationPlugin();

    expect(plugin.name).toBe('federation');
    expect(plugin.tier).toBe('standard');
    expect(plugin.enabled).toBe(false);
    expect(plugin.seedMenu).toBe(false);

    const app = new Elysia();
    for (const routes of serverPluginRoutes([plugin])) app.use(routes as any);

    const info = await app.handle(new Request('http://local/info'));
    expect(info.status).toBe(200);
    const infoBody = await info.json() as { maw?: { schema?: string }; node?: string; oracle?: string };
    expect(infoBody.maw?.schema).toBe('1');
    expect(infoBody.node).toStartWith('arra@');
    expect(infoBody.oracle).toBe('arra');

    const identity = await app.handle(new Request('http://local/api/identity'));
    expect(identity.status).toBe(200);
    const identityBody = await identity.json() as { pubkey?: string; node?: string; oracle?: string };
    expect(identityBody.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(identityBody.node).toStartWith('arra@');
    expect(identityBody.oracle).toBe('arra');

    const peers = await app.handle(new Request('http://local/api/peers'));
    expect(peers.status).toBe(200);
    expect(await peers.json()).toEqual({ peers: [] });
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
