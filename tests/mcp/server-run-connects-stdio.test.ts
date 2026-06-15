import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server run connects the SDK server to a stdio transport', async () => {
  const server = withProxyServer();
  try {
    let transportName = '';
    (server as any).server.connect = async (transport: object) => { transportName = transport.constructor.name; };
    await server.run();
    expect(transportName).toBe('StdioServerTransport');
  } finally {
    await server.cleanup();
  }
});
