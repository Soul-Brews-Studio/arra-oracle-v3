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
  startServerPlugins,
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


function writeGlobalConfig(config: unknown) {
  const dir = join(tmp, 'xdg', 'arra');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
}

const testLifecycleOptions = {
  dataDir: tmp,
  vectorUrl: 'http://vector.local',
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

afterEach(() => {
  rmSync(join(tmp, 'xdg'), { recursive: true, force: true });
});

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

  test('unified manifest plugin exposes api route and lifecycle from one handler', async () => {
    const { createBuiltinServerPlugins } = await import('../plugin/builtin.ts');
    const enabled = enabledServerPlugins(loadServerPlugins(await createBuiltinServerPlugins({ dataDir: tmp }), {
      enabledPlugins: ['unified-example'],
    }));
    expect(enabled.some((plugin) => plugin.name === 'unified-example')).toBe(true);

    const app = new Elysia();
    for (const routes of serverPluginRoutes(enabled)) app.use(routes as any);

    const response = await app.handle(new Request('http://local/api/unified-example', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase: 5 }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      plugin: 'unified-example',
      source: 'api',
      method: 'POST',
      body: { phase: 5 },
    });

    const events: string[] = [];
    const unified = enabled.filter((plugin) => plugin.name === 'unified-example');
    const lifecycle = await startServerPlugins(unified, {
      ...testLifecycleOptions,
      logger: {
        info: (...args) => events.push(args.join(' ')),
        warn: () => {},
        error: () => {},
      },
    });
    await lifecycle.stop();
    expect(events).toEqual(['[unified-example] start', '[unified-example] stop']);
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

  test('lifecycle starts plugins in order and stops them in reverse', async () => {
    const events: string[] = [];
    const plugins: ServerPlugin[] = [
      {
        name: 'worker-a',
        tier: 'standard',
        start: (context) => {
          events.push(`start:a:${context.dataDir}:${context.vectorUrl}:${context.signal.aborted}`);
        },
        stop: (context) => {
          events.push(`stop:a:${context.signal.aborted}`);
        },
      },
      {
        name: 'worker-b',
        tier: 'standard',
        start: () => {
          events.push('start:b');
        },
        stop: () => {
          events.push('stop:b');
        },
      },
    ];

    const lifecycle = await startServerPlugins(plugins, testLifecycleOptions);
    expect(lifecycle.plugins.map((plugin) => plugin.name)).toEqual(['worker-a', 'worker-b']);
    expect(events).toEqual([`start:a:${tmp}:http://vector.local:false`, 'start:b']);

    await lifecycle.stop();
    await lifecycle.stop();
    expect(events).toEqual([`start:a:${tmp}:http://vector.local:false`, 'start:b', 'stop:b', 'stop:a:true']);
  });

  test('lifecycle rolls back already-started plugins when a later start fails', async () => {
    const events: string[] = [];
    let signal: AbortSignal | null = null;
    const plugins: ServerPlugin[] = [
      {
        name: 'started-worker',
        tier: 'standard',
        start: (context) => {
          signal = context.signal;
          events.push('start:started');
        },
        stop: (context) => {
          events.push(`stop:started:${context.signal.aborted}`);
        },
      },
      {
        name: 'broken-worker',
        tier: 'standard',
        start: () => {
          events.push('start:broken');
          throw new Error('boom');
        },
        stop: () => {
          events.push('stop:broken');
        },
      },
    ];

    await expect(startServerPlugins(plugins, testLifecycleOptions)).rejects.toThrow('boom');
    expect(signal?.aborted).toBe(true);
    expect(events).toEqual(['start:started', 'start:broken', 'stop:started:true']);
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
