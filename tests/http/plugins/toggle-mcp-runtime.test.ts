import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { createMcpRoutes } from '../../../src/routes/mcp/index.ts';
import { createPluginsRouter } from '../../../src/routes/plugins/index.ts';
import { pluginDir } from '../../plugins/_fixtures.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-plugin-toggle-runtime-'));
const previousDirs = process.env.ARRA_PLUGIN_DIRS;
process.env.ARRA_PLUGIN_DIRS = tmp;

afterAll(() => {
  if (previousDirs === undefined) delete process.env.ARRA_PLUGIN_DIRS;
  else process.env.ARRA_PLUGIN_DIRS = previousDirs;
  rmSync(tmp, { recursive: true, force: true });
});

function postToggle(app: Elysia, name: string, body?: Record<string, unknown>) {
  return app.handle(new Request(`http://local/api/plugins/${name}/toggle`, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }));
}

function toolNames(runtime: Awaited<ReturnType<typeof loadUnifiedPlugins>>): string[] {
  return runtime.mcpTools.map((tool) => tool.name).sort();
}

async function listedPluginTools(app: Elysia): Promise<string[]> {
  const response = await app.handle(new Request('http://local/api/mcp/tools'));
  const body = await response.json() as { tools: Array<{ name: string; source: string }> };
  return body.tools.filter((tool) => tool.source === 'plugin').map((tool) => tool.name).sort();
}

describe('POST /api/plugins/:name/toggle', () => {
  test('plugs MCP tools out and back in through the existing runtime', async () => {
    const dir = pluginDir(tmp, 'toggle-runtime', {
      mcpTools: [{ name: 'oracle_toggle_runtime', description: 'Toggle runtime tool', inputSchema: {}, handler: 'tool' }],
    }, "export function tool(ctx) { return { ok: true, body: { plugin: ctx.plugin, args: ctx.body } }; }\n");
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const app = new Elysia()
      .use(createPluginsRouter({ dir: tmp, registry: runtime.pluginRegistry, runtime }))
      .use(createMcpRoutes(runtime.mcpTools));

    expect(toolNames(runtime)).toEqual(['oracle_toggle_runtime']);
    expect(await listedPluginTools(app)).toEqual(['oracle_toggle_runtime']);

    const offResponse = await postToggle(app, 'toggle-runtime', { enabled: false });
    expect(offResponse.status).toBe(200);
    expect(await offResponse.json()).toMatchObject({
      ok: true,
      plugin: 'toggle-runtime',
      enabled: false,
      reloaded: true,
      mcpTools: [],
      mcpToolCount: 0,
    });
    expect(JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8')).enabled).toBe(false);
    expect(toolNames(runtime)).toEqual([]);
    expect(await listedPluginTools(app)).toEqual([]);
    expect(await runtime.callMcpTool('oracle_toggle_runtime', {})).toEqual({
      ok: false,
      error: 'MCP tool not found: oracle_toggle_runtime',
    });

    const onResponse = await postToggle(app, 'toggle-runtime', { enabled: true });
    expect(onResponse.status).toBe(200);
    expect(await onResponse.json()).toMatchObject({
      ok: true,
      plugin: 'toggle-runtime',
      enabled: true,
      mcpTools: ['oracle_toggle_runtime'],
      mcpToolCount: 1,
    });
    expect(toolNames(runtime)).toEqual(['oracle_toggle_runtime']);
    expect(await listedPluginTools(app)).toEqual(['oracle_toggle_runtime']);
    expect(await runtime.callMcpTool('oracle_toggle_runtime', { q: 'again' })).toEqual({
      ok: true,
      body: { plugin: 'toggle-runtime', args: { q: 'again' } },
    });
  });

  test('returns 404 for missing plugin manifests', async () => {
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const app = new Elysia().use(createPluginsRouter({ dir: tmp, registry: runtime.pluginRegistry, runtime }));
    const response = await postToggle(app, 'missing-plugin', { enabled: false });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: 'plugin manifest not found', name: 'missing-plugin' });
  });
});
