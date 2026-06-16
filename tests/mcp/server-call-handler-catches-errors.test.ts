import { expect, test } from 'bun:test';
import { callToolHandler, withProxyServer } from './support/server.ts';

test('MCP server call handler turns runtime exceptions into tool errors', async () => {
  const server = withProxyServer();
  try {
    (server as any).toolRegistry = async () => new Map([['boom', { name: 'boom', readOnly: true, handler: () => { throw new Error('kaboom'); } }]]);
    const response = await callToolHandler(server)({ params: { name: 'boom', arguments: {} } });
    expect(response).toEqual({ content: [{ type: 'text', text: 'Error: kaboom' }], isError: true });
  } finally {
    await server.cleanup();
  }
});
