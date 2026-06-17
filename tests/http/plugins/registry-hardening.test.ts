import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { createPluginsRouter } from '../../../src/routes/plugins/index.ts';
import { pluginDir } from '../../plugins/_fixtures.ts';

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function pluginsBody(app: Elysia) {
  const res = await app.handle(new Request('http://local/api/plugins'));
  expect(res.status).toBe(200);
  return await res.json() as { count: number; plugins: Array<Record<string, any>>; dir: string };
}

describe('GET /api/plugins registry hardening', () => {
  test('enumerates every registered unified-plugin surface over HTTP', async () => {
    const root = tempRoot('arra-plugin-surfaces-');
    pluginDir(root, 'surface-http-pack', {
      mcpTools: [
        { name: 'oracle_surface_http', description: 'tool', inputSchema: {}, handler: 'tool' },
        { name: 'oracle_surface_disabled', description: 'off', inputSchema: {}, handler: 'tool', enabled: false },
      ],
      apiRoutes: [{ path: '/api/surface-http', methods: ['POST'], handler: 'api' }],
      proxy: [{ path: '/api/surface-proxy', targetEnv: 'SURFACE_PROXY_URL', methods: ['GET'] }],
      server: { command: 'bun', args: ['server.ts'], healthPath: '/health', autostart: false },
      menu: [{ label: 'Surface HTTP', path: '/surface-http', group: 'tools', order: 7 }],
      cliSubcommands: [{ command: 'surface-http', help: 'surface cli', handler: 'cli' }],
      exportFormats: [{ name: 'surface-http', handler: 'exporter' }],
    });
    const runtime = await loadUnifiedPlugins({ dirs: [root] });
    const app = new Elysia().use(createPluginsRouter({ dir: root, registry: runtime.pluginRegistry }));

    const body = await pluginsBody(app);
    const plugin = body.plugins[0];

    expect(body.count).toBe(1);
    expect(plugin).toMatchObject({
      name: 'surface-http-pack',
      status: 'ok',
      surfaces: ['mcpTools', 'apiRoutes', 'proxy', 'server', 'menu', 'cliSubcommands', 'exportFormats'],
      mcpTools: [{ name: 'oracle_surface_http', source: 'plugin', plugin: 'surface-http-pack' }],
      apiRoutes: [{ path: '/api/surface-http', methods: ['POST'] }],
      proxy: [{ path: '/api/surface-proxy', targetEnv: 'SURFACE_PROXY_URL', methods: ['GET'] }],
      server: { command: 'bun', args: ['server.ts'], healthPath: '/health', autostart: false },
      menu: { label: 'Surface HTTP', path: '/surface-http', group: 'tools', order: 7 },
      cliSubcommands: [{ command: 'surface-http', help: 'surface cli' }],
      exportFormats: [{ name: 'surface-http', extension: 'surface-http' }],
    });
    expect(plugin.mcpTools.map((tool: Record<string, unknown>) => tool.name)).not.toContain('oracle_surface_disabled');
    expect(plugin.mcpTools[0]).not.toHaveProperty('handler');
  });

  test('returns an empty registered-plugin listing without scanning fallbacks', async () => {
    const root = tempRoot('arra-plugin-empty-registry-');
    const runtime = await loadUnifiedPlugins({ dirs: [root] });
    const app = new Elysia().use(createPluginsRouter({ dir: root, registry: runtime.pluginRegistry }));

    expect(await pluginsBody(app)).toMatchObject({ count: 0, plugins: [], dir: root });
  });

  test('returns a counted empty scanner result for a missing plugin directory', async () => {
    const missing = join(tempRoot('arra-plugin-missing-parent-'), 'missing');
    const app = new Elysia().use(createPluginsRouter({ dir: missing }));

    expect(await pluginsBody(app)).toEqual({ count: 0, plugins: [], dir: missing });
  });
});
