import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server vector health marks missing stores unavailable', async () => {
  const server = withProxyServer();
  try {
    (server as any).vectorStore = null;
    await (server as any).verifyVectorHealth();
    expect((server as any).vectorStatus).toBe('unavailable');
  } finally {
    await server.cleanup();
  }
});
