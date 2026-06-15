import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server vector health accepts connected empty stores', async () => {
  const server = withProxyServer();
  try {
    (server as any).vectorStore = { name: 'fake', getStats: async () => ({ count: 0 }), close: async () => {} };
    await (server as any).verifyVectorHealth();
    expect((server as any).vectorStatus).toBe('connected');
  } finally {
    await server.cleanup();
  }
});
