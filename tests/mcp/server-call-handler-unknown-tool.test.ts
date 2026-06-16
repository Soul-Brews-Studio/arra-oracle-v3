import { expect, test } from 'bun:test';
import { callToolHandler, withProxyServer } from './support/server.ts';

test('MCP server call handler returns errors for unknown tools', async () => {
  const server = withProxyServer();
  try {
    const response = await callToolHandler(server)({ params: { name: 'oracle_missing', arguments: {} } });
    expect(response).toEqual({ content: [{ type: 'text', text: 'Error: Unknown tool: oracle_missing' }], isError: true });
  } finally {
    await server.cleanup();
  }
});
