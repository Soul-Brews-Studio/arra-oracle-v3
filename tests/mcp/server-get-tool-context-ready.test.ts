import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server tool context returns initialized resources', async () => {
  const server = withProxyServer();
  try {
    (server as any).embeddedReady = Promise.resolve();
    (server as any).sqlite = { close: () => {} };
    (server as any).db = { marker: true };
    (server as any).vectorStore = { close: async () => {} };
    const ctx = await (server as any).getToolCtx();
    expect(ctx.vectorStatus).toBe('unknown');
  } finally {
    await server.cleanup();
  }
});
