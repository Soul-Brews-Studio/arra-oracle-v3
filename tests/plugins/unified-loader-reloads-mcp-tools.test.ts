import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUnifiedPlugins } from '../../src/plugins/unified-loader.ts';
import { pluginDir } from './_fixtures.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-unified-mcp-reload-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function toolNames(runtime: Awaited<ReturnType<typeof loadUnifiedPlugins>>): string[] {
  return runtime.mcpTools.map((tool) => tool.name).sort();
}

describe('UnifiedRuntime.reload MCP tools', () => {
  test('adds and removes plugin MCP tools without recreating the runtime', async () => {
    const alphaDir = pluginDir(tmp, 'alpha-pack', {
      mcpTools: [{ name: 'oracle_alpha_runtime', description: 'Alpha runtime tool', inputSchema: {}, handler: 'tool' }],
    }, "export function tool(ctx) { return { ok: true, body: { plugin: ctx.plugin, args: ctx.body } }; }\n");
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });

    expect(runtime.pluginCount).toBe(1);
    expect(toolNames(runtime)).toEqual(['oracle_alpha_runtime']);
    expect(await runtime.callMcpTool('oracle_alpha_runtime', { q: 'first' })).toEqual({
      ok: true,
      body: { plugin: 'alpha-pack', args: { q: 'first' } },
    });

    pluginDir(tmp, 'beta-pack', {
      mcpTools: [{ name: 'oracle_beta_runtime', description: 'Beta runtime tool', inputSchema: {}, handler: 'tool' }],
    }, "export function tool(ctx) { return { ok: true, body: { plugin: ctx.plugin, args: ctx.body } }; }\n");
    await runtime.reload();

    expect(runtime.pluginCount).toBe(2);
    expect(toolNames(runtime)).toEqual(['oracle_alpha_runtime', 'oracle_beta_runtime']);
    expect(await runtime.callMcpTool('oracle_beta_runtime', { q: 'added' })).toEqual({
      ok: true,
      body: { plugin: 'beta-pack', args: { q: 'added' } },
    });

    rmSync(alphaDir, { recursive: true, force: true });
    await runtime.reload();

    expect(runtime.pluginCount).toBe(1);
    expect(toolNames(runtime)).toEqual(['oracle_beta_runtime']);
    expect(await runtime.callMcpTool('oracle_alpha_runtime', {})).toEqual({
      ok: false,
      error: 'MCP tool not found: oracle_alpha_runtime',
    });
  });
});
