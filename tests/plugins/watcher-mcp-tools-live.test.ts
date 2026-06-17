import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createMcpRoutes } from '../../src/routes/mcp/index.ts';
import { loadUnifiedPlugins, type UnifiedRuntime } from '../../src/plugins/unified-loader.ts';
import { createUnifiedPluginRouteMount, createUnifiedRuntimeRef } from '../../src/plugins/runtime-routes.ts';
import { swapUnifiedRuntimeWithLifecycle } from '../../src/plugins/runtime-reload.ts';
import { watchPluginManifests, type PluginWatchFn } from '../../src/plugins/watcher.ts';
import { createNotFoundMiddleware } from '../../src/middleware/not-found.ts';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arra-plugin-mcp-watch-'));
  temps.push(dir);
  return dir;
}

function appFor(ref: ReturnType<typeof createUnifiedRuntimeRef<UnifiedRuntime>>) {
  const app = new Elysia()
    .use(createMcpRoutes({ runtimeRef: ref }))
    .get('/api/core', () => ({ source: 'core' }));
  app.use(createUnifiedPluginRouteMount(ref, { localRoutes: () => app.routes }));
  app.use(createNotFoundMiddleware(() => app.routes));
  return app;
}

async function getJson(app: Elysia, path: string) {
  const response = await app.handle(new Request(`http://local${path}`));
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function pluginToolNames(app: Elysia): Promise<string[]> {
  const { body } = await getJson(app, '/api/mcp/tools') as { body: { tools: Array<Record<string, unknown>> } };
  return body.tools.filter((tool) => tool.source === 'plugin').map((tool) => String(tool.name)).sort();
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for plugin watcher reload');
    await Bun.sleep(5);
  }
}

function writeLivePlugin(dir: string) {
  writeFileSync(join(dir, 'index.ts'), 'export function hello(ctx) { return { body: { plugin: ctx.plugin } }; }\n');
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name: 'live-watch',
    version: '1.0.0',
    entry: './index.ts',
    apiRoutes: [{ path: '/api/live-watch/hello', methods: ['GET'], handler: 'hello' }],
    mcpTools: [{ name: 'live_watch_tool', description: 'Live watch tool', inputSchema: {}, handler: 'hello' }],
  }, null, 2));
}

describe('watchPluginManifests live MCP plug-in/out', () => {
  test('drop and remove plugin.json updates /api/mcp/tools without remounting the app', async () => {
    const root = tempRoot();
    const plugin = join(root, 'live-watch');
    mkdirSync(plugin, { recursive: true });
    const ref = createUnifiedRuntimeRef(await loadUnifiedPlugins({ dirs: [root] }));
    const app = appFor(ref);
    const lifecycle = { servers: { started: 0, stop: async () => undefined } };
    const reloads: string[][] = [];
    let emit: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const watch: PluginWatchFn = (_path, _options, listener) => {
      emit = listener;
      return { close: () => undefined };
    };
    const watcher = watchPluginManifests({
      dirs: [root],
      debounceMs: 1,
      watch,
      onReload: async (next) => {
        await swapUnifiedRuntimeWithLifecycle(ref, lifecycle, next, {
          startServers: async () => ({ started: 0, stop: async () => undefined }),
        });
        reloads.push(next.pluginStatuses().map((status) => status.name).sort());
      },
    });
    if (!emit) throw new Error('watcher did not register');

    try {
      expect(await pluginToolNames(app)).toEqual([]);
      expect((await getJson(app, '/api/live-watch/hello')).response.status).toBe(404);

      writeLivePlugin(plugin);
      emit('rename', 'live-watch/plugin.json');
      await waitFor(() => reloads.length === 1);
      expect(await pluginToolNames(app)).toEqual(['live_watch_tool']);
      expect((await getJson(app, '/api/live-watch/hello')).body).toEqual({ plugin: 'live-watch' });

      unlinkSync(join(plugin, 'plugin.json'));
      emit('rename', 'live-watch/plugin.json');
      await waitFor(() => reloads.length === 2);
      expect(await pluginToolNames(app)).toEqual([]);
      expect((await getJson(app, '/api/live-watch/hello')).response.status).toBe(404);
      expect((await getJson(app, '/api/core')).body).toEqual({ source: 'core' });
    } finally {
      watcher.close();
    }
  });
});
