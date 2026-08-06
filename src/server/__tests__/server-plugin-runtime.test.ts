import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Elysia } from 'elysia';

import {
  enabledServerPlugins,
  loadServerPlugins,
  serverPluginRoutes,
  startServerPlugins,
} from '../plugin/loader.ts';
import type { ServerPlugin } from '../plugin/types.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-server-plugin-runtime-'));
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
  // Keep the shared db module open; other Bun test files reuse the same module
  // instance even under --isolate.
});

describe('server plugin runtime', () => {
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
