import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { loadUnifiedPlugins } from '../unified-loader.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-unified-loader-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function pluginDir(name: string, manifest: Record<string, unknown>, entry = '') {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name,
    version: '1.0.0',
    entry: './index.ts',
    ...manifest,
  }, null, 2));
  writeFileSync(join(dir, 'index.ts'), entry || 'export function noop() { return { ok: true }; }\n');
  return dir;
}

describe('unified plugin loader', () => {
  test('skips absent surfaces without throwing', async () => {
    pluginDir('metadata-only', {});
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });

    expect(runtime.routes).toHaveLength(0);
    expect(runtime.mcpTools).toHaveLength(0);
    expect(runtime.menu).toHaveLength(0);
    expect(runtime.cliSubcommands).toHaveLength(0);
    expect(runtime.servers).toHaveLength(0);
  });

  test('registers each declared surface and mounts api handlers', async () => {
    pluginDir('surface-pack', {
      mcpTools: [{ name: 'oracle_surface_pack', description: 'tool', inputSchema: {}, handler: 'tool' }],
      apiRoutes: [{ path: '/api/surface-pack', methods: ['POST'], handler: 'api' }],
      proxy: [{ path: '/api/surface-proxy', targetEnv: 'SURFACE_PROXY_URL' }],
      server: { command: 'bun', args: ['--version'], autostart: false },
      menu: [{ label: 'Surface Pack', path: '/surface-pack', group: 'tools', order: 42 }],
      cliSubcommands: [{ command: 'surface-pack', help: 'surface cli', handler: 'cli' }],
    }, `
      export function api(ctx) {
        return { ok: true, body: { plugin: ctx.plugin, method: ctx.request.method, body: ctx.body } };
      }
      export function tool(ctx) {
        return { ok: true, body: { plugin: ctx.plugin, source: ctx.source, args: ctx.args } };
      }
    `);

    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    expect(runtime.mcpTools.map((tool) => tool.name)).toEqual(['oracle_surface_pack']);
    expect(await runtime.callMcpTool('oracle_surface_pack', { ok: true })).toEqual({
      ok: true,
      body: { plugin: 'surface-pack', source: 'mcp', args: [{ ok: true }] },
    });
    expect(runtime.menu.map((item) => item.path)).toEqual(['/surface-pack']);
    expect(runtime.cliSubcommands.map((cmd) => cmd.command)).toEqual(['surface-pack']);
    expect(runtime.servers.map((server) => server.plugin)).toEqual(['surface-pack']);
    expect(runtime.routes).toHaveLength(3);

    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as any);
    const response = await app.handle(new Request('http://local/api/surface-pack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      plugin: 'surface-pack',
      method: 'POST',
      body: { ok: true },
    });
  });
});
