import { expect, test } from 'bun:test';
import { callToolHandler, withProxyServer } from './support/server.ts';

test('MCP server call handler returns a tool error for blank names', async () => {
  const server = withProxyServer();
  try {
    const response = await callToolHandler(server)({ params: { name: '  ', arguments: {} } });
    expect(response).toEqual({
      content: [{ type: 'text', text: 'Error: Tool name must be a non-empty string' }],
      isError: true,
    });
  } finally {
    await server.cleanup();
  }
});
