import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server skips vector preconnect in HTTP proxy mode', async () => {
  const server = withProxyServer();
  try {
    await expect(server.preConnectVector()).resolves.toBeUndefined();
  } finally {
    await server.cleanup();
  }
});
