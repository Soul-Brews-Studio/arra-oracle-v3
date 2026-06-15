import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server tool context rejects missing embedded resources', async () => {
  const server = withProxyServer();
  try {
    (server as any).embeddedReady = Promise.resolve();
    await expect((server as any).getToolCtx()).rejects.toThrow('Embedded Oracle resources failed to initialize');
  } finally {
    await server.cleanup();
  }
});
