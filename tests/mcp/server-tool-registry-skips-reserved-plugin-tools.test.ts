import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server registry keeps built-in tools ahead of reserved plugin names', async () => {
  const server = withProxyServer();
  try {
    (server as any).unifiedRuntimeReady = Promise.resolve({ routes: [], menu: [], cliSubcommands: [], servers: [], init: async () => {}, stop: async () => {}, mcpTools: [{ plugin: 'demo', name: 'oracle_search', handler: 'run', inputSchema: { type: 'object' } }], callMcpTool: async () => 'ok' });
    const registry = await (server as any).toolRegistry();
    expect(registry.get('oracle_search').handlerId).toBe('handleSearch');
  } finally {
    await server.cleanup();
  }
});
