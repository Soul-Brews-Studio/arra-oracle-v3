import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server can load default embedded dependencies lazily', async () => {
  const server = withProxyServer();
  try {
    const deps = await (server as any).loadEmbeddedDeps();
    expect(typeof deps.createDatabase).toBe('function');
  } finally {
    await server.cleanup();
  }
});
