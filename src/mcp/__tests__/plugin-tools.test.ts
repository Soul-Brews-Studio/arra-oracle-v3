import { describe, expect, it } from 'bun:test';
import { pluginMcpToolsFrom } from '../plugin-tools.ts';
import type { UnifiedRuntime } from '../../plugins/unified-loader.ts';

describe('plugin MCP registry adapter', () => {
  it('binds loader MCP tools to runtime handlers', async () => {
    const runtime: UnifiedRuntime = {
      routes: [], menu: [], cliSubcommands: [], servers: [], init: async () => {}, stop: async () => {},
      mcpTools: [{
        plugin: 'demo', name: 'oracle_demo', description: 'Demo', handler: 'run',
        inputSchema: { type: 'object', properties: {} }, readOnly: true,
      }],
      callMcpTool: async (name, args) => ({ ok: true, body: { name, args } }),
    };

    const [tool] = pluginMcpToolsFrom(runtime);
    expect(tool.name).toBe('oracle_demo');
    expect(tool.handlerId).toBe('demo:run');
    expect(tool.group).toBe('plugin:demo');
    expect(await tool.handler({ x: 1 }, { version: 'test', getToolCtx: async () => { throw new Error('unused'); } })).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ name: 'oracle_demo', args: { x: 1 } }, null, 2) }],
    });
  });
});
