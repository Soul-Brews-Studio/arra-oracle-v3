import { expect, test } from 'bun:test';
import { listToolsHandler, withProxyServer } from './support/server.ts';

test('MCP server list handler exposes registered tool definitions', async () => {
  const server = withProxyServer();
  try {
    const listed = await listToolsHandler(server)();
    expect(listed.tools.some((tool: { name: string }) => tool.name === 'oracle_mcp_call')).toBe(true);
  } finally {
    await server.cleanup();
  }
});
