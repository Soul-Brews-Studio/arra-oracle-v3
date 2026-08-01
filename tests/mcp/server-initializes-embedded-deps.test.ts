import { expect, test } from 'bun:test';
import { OracleMCPServer } from '../../src/mcp/server.ts';
import { clearEmbedderRuntimeStatusForTests } from '../../src/vector/embedder-config.ts';
import { allToolGroups } from './support/server.ts';

test('MCP server initializes embedded resources from injectable dependencies', async () => {
  process.env.ORACLE_HTTP_URL = '';
  const vectorStore = { name: 'fake', getStats: async () => ({ count: 0 }), close: async () => {} };
  const server = new OracleMCPServer({ toolGroups: allToolGroups, embeddedDeps: {
    createVectorStoreForModel: () => vectorStore as any,
    getEmbeddingModels: () => ({ 'bge-m3': {} }),
    createDatabase: () => ({ sqlite: { close: () => {} } as any, db: {} as any }),
    probeEmbedder: async () => ({ status: 'connected', provider: 'ollama', source: 'auto-default', explicit: false }),
  } });
  try {
    await (server as any).embeddedReady;
    expect((server as any).vectorStore).toBe(vectorStore);
  } finally {
    await server.cleanup();
    clearEmbedderRuntimeStatusForTests();
  }
});

test('read-only MCP opens embedded storage in read-only mode', async () => {
  process.env.ORACLE_HTTP_URL = '';
  let receivedReadonly: unknown;
  const vectorStore = { name: 'fake', getStats: async () => ({ count: 0 }), close: async () => {} };
  const server = new OracleMCPServer({ readOnly: true, toolGroups: allToolGroups, embeddedDeps: {
    createVectorStoreForModel: () => vectorStore as any,
    getEmbeddingModels: () => ({ 'bge-m3': {} }),
    createDatabase: (...args: unknown[]) => {
      receivedReadonly = (args[1] as { readonly?: unknown } | undefined)?.readonly;
      return { sqlite: { close: () => {} } as any, db: {} as any };
    },
    probeEmbedder: async () => ({ status: 'connected', provider: 'ollama', source: 'auto-default', explicit: false }),
  } });
  try {
    await (server as any).embeddedReady;
    expect(receivedReadonly).toBe(true);
  } finally {
    await server.cleanup();
    clearEmbedderRuntimeStatusForTests();
  }
});
