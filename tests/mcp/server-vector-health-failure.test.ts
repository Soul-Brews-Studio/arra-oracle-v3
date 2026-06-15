import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server vector health records adapter failures', async () => {
  const server = withProxyServer();
  try {
    (server as any).vectorStore = { name: 'fake', getStats: async () => { throw new Error('down'); }, close: async () => {} };
    await (server as any).verifyVectorHealth();
    expect((server as any).vectorStatus).toBe('unavailable');
  } finally {
    await server.cleanup();
  }
});
