import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server vector health records connected stores with documents', async () => {
  const server = withProxyServer();
  try {
    (server as any).vectorStore = { name: 'fake', getStats: async () => ({ count: 2 }), close: async () => {} };
    await (server as any).verifyVectorHealth();
    expect((server as any).vectorStatus).toBe('connected');
  } finally {
    await server.cleanup();
  }
});
