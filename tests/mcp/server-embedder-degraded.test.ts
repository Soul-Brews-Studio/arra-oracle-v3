import { afterEach, expect, test } from 'bun:test';
import { createDatabase, oracleDocuments } from '../../src/db/index.ts';
import { clearEmbedderRuntimeStatusForTests } from '../../src/vector/embedder-config.ts';
import { OracleMCPServer } from '../../src/mcp/server.ts';
import { allToolGroups, callToolHandler } from './support/server.ts';

const saved = {
  httpUrl: process.env.ORACLE_HTTP_URL,
  vectorEnabled: process.env.ORACLE_VECTOR_ENABLED,
  rerankerUrl: process.env.ORACLE_RERANKER_URL,
};

afterEach(() => {
  restore('ORACLE_HTTP_URL', saved.httpUrl);
  restore('ORACLE_VECTOR_ENABLED', saved.vectorEnabled);
  restore('ORACLE_RERANKER_URL', saved.rerankerUrl);
  clearEmbedderRuntimeStatusForTests();
});

test('MCP embedder degradation is observable and FTS5 search still returns', async () => {
  process.env.ORACLE_HTTP_URL = '';
  process.env.ORACLE_VECTOR_ENABLED = '1';
  delete process.env.ORACLE_RERANKER_URL;
  const connection = createDatabase(':memory:');
  seedFtsDoc(connection);
  const warningLines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => warningLines.push(args.map(String).join(' '));
  const server = new OracleMCPServer({
    toolGroups: allToolGroups,
    embeddedDeps: {
      createVectorStoreForModel: () => fakeVectorStore(),
      getEmbeddingModels: () => ({ 'bge-m3': { collection: 'oracle_knowledge', model: 'bge-m3', provider: 'ollama' } }),
      createDatabase: () => connection,
      probeEmbedder: async () => ({
        status: 'degraded', provider: 'ollama', source: 'auto-default', explicit: false,
        reason: 'ECONNREFUSED 127.0.0.1:11434', checkedAt: 'now',
      }),
    },
  });
  try {
    const stats = await toolJson(server, 'oracle_stats', {});
    expect(stats).toMatchObject({
      vector_status: 'degraded',
      vector_reason: 'ECONNREFUSED 127.0.0.1:11434',
      embedder_provider: 'ollama',
      fts_indexed: 1,
    });

    const search = await toolJson(server, 'oracle_search', { query: 'needle', mode: 'hybrid', limit: 3 });
    expect(search.results.map((item: { id: string }) => item.id)).toContain('fts-doc');
    expect(search.metadata.vectorAvailable).toBe(false);
    expect(search.metadata.warning).toContain('ECONNREFUSED 127.0.0.1:11434');
    expect(warningLines.join('\n')).toContain('[Oracle] embedder ollama unreachable (ECONNREFUSED 127.0.0.1:11434) → degraded to FTS5-only');
  } finally {
    console.error = originalError;
    await server.cleanup();
  }
});

test('MCP keeps FTS5 tools available when degraded embedder prevents vector store construction', async () => {
  process.env.ORACLE_HTTP_URL = '';
  process.env.ORACLE_VECTOR_ENABLED = '1';
  delete process.env.ORACLE_RERANKER_URL;
  const connection = createDatabase(':memory:');
  seedFtsDoc(connection);
  const warningLines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => warningLines.push(args.map(String).join(' '));
  const server = new OracleMCPServer({
    toolGroups: allToolGroups,
    embeddedDeps: {
      createVectorStoreForModel: () => { throw new Error('OpenAI API key required. Set OPENAI_API_KEY.'); },
      getEmbeddingModels: () => ({ 'bge-m3': { collection: 'oracle_knowledge', model: 'bge-m3', provider: 'openai' } }),
      createDatabase: () => connection,
      probeEmbedder: async () => ({
        status: 'degraded', provider: 'openai', source: 'env', explicit: true,
        reason: 'no embedder configured/reachable — FTS5-only (OpenAI API key required. Set OPENAI_API_KEY.)',
        checkedAt: 'now',
      }),
    },
  });
  try {
    const stats = await toolJson(server, 'oracle_stats', {});
    expect(stats.vector_status).toBe('degraded');
    expect(stats.embedder_provider).toBe('openai');
    const search = await toolJson(server, 'oracle_search', { query: 'needle', mode: 'hybrid', limit: 3 });
    expect(search.results.map((item: { id: string }) => item.id)).toContain('fts-doc');
    expect(search.metadata.vectorAvailable).toBe(false);
    expect(warningLines.join('\n')).toContain('[Oracle] embedder openai unreachable');
  } finally {
    console.error = originalError;
    await server.cleanup();
  }
});

async function toolJson(server: OracleMCPServer, name: string, args: Record<string, unknown>) {
  const response = await callToolHandler(server)({ params: { name, arguments: args } });
  expect(response.isError).toBeUndefined();
  return JSON.parse(response.content[0].text);
}

function seedFtsDoc(connection: ReturnType<typeof createDatabase>) {
  const now = Date.now();
  connection.db.insert(oracleDocuments).values({
    id: 'fts-doc', type: 'learning', sourceFile: 'ψ/learn/fts.md',
    concepts: '["needle"]', createdAt: now, updatedAt: now, indexedAt: now,
  }).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'fts-doc', 'Graceful embedder degradation keeps lexical needle results', '["needle"]',
  );
}

function fakeVectorStore() {
  return {
    name: 'fake-vector',
    getStats: async () => ({ count: 0 }),
    query: async () => { throw new Error('vector should be skipped while degraded'); },
    connect: async () => {},
    close: async () => {},
  } as any;
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
