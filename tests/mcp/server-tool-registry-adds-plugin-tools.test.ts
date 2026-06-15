import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server registry adds non-reserved plugin MCP tools', async () => {
  const server = withProxyServer();
  try {
    (server as any).unifiedRuntimeReady = Promise.resolve({ routes: [], menu: [], cliSubcommands: [], servers: [], pluginStatuses: () => [], init: async () => {}, stop: async () => {}, mcpTools: [{ plugin: 'demo', name: 'demo_tool', handler: 'run', inputSchema: { type: 'object' } }], callMcpTool: async () => 'ok' });
    const registry = await (server as any).toolRegistry();
    expect(registry.has('demo_tool')).toBe(true);
  } finally {
    await server.cleanup();
  }
});
