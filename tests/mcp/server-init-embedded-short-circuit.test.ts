import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server embedded initialization short-circuits when resources exist', async () => {
  const server = withProxyServer({ embeddedDeps: { createVectorStoreForModel: () => { throw new Error('unused'); }, getEmbeddingModels: () => ({ 'bge-m3': {} }), createDatabase: () => { throw new Error('unused'); } } });
  try {
    (server as any).sqlite = { close: () => {} };
    (server as any).db = {};
    (server as any).vectorStore = { close: async () => {} };
    await expect((server as any).initEmbedded()).resolves.toBeUndefined();
  } finally {
    await server.cleanup();
  }
});
