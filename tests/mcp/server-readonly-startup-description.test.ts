import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearEmbedderRuntimeStatusForTests } from '../../src/vector/embedder-config.ts';

function constructorOptions() {
  const vectorStore = {
    name: 'fake',
    getStats: async () => ({ count: 0 }),
    close: async () => {},
  };
  return {
    readOnly: true,
    toolGroups: {
      search: true,
      knowledge: true,
      session: true,
      forum: true,
      oracle: true,
      trace: true,
      standalone: true,
    },
    embeddedDeps: {
      createVectorStoreForModel: () => vectorStore as any,
      getEmbeddingModels: () => ({ 'bge-m3': {} }),
      createDatabase: () => ({ sqlite: { close: () => {} } as any, db: {} as any }),
      probeEmbedder: async () => ({ status: 'connected' as const, provider: 'test', source: 'explicit' as const, explicit: true }),
    },
    unifiedRuntime: {} as any,
    watchPlugins: false as const,
    installSignalHandlers: false,
  };
}

test('read-only startup describes strict and bounded-retro modes exactly', async () => {
  const originalError = console.error;
  const originalEnv = {
    NEO_ARRA_API: process.env.NEO_ARRA_API,
    ORACLE_API: process.env.ORACLE_API,
    ORACLE_DATA_DIR: process.env.ORACLE_DATA_DIR,
    ORACLE_DB_PATH: process.env.ORACLE_DB_PATH,
    ORACLE_HTTP_URL: process.env.ORACLE_HTTP_URL,
    ORACLE_READ_ONLY: process.env.ORACLE_READ_ONLY,
    ORACLE_REMOTE_WRITE_URL: process.env.ORACLE_REMOTE_WRITE_URL,
    ORACLE_VECTOR_DB: process.env.ORACLE_VECTOR_DB,
    ORACLE_VECTOR_DB_PATH: process.env.ORACLE_VECTOR_DB_PATH,
  };
  const dataDir = mkdtempSync(join(tmpdir(), 'arra-ro-startup-'));
  const oracleDbPath = join(dataDir, 'oracle.db');
  const vectorsDbPath = join(dataDir, 'vectors.db');
  const logs: string[] = [];
  const servers: Array<{ cleanup(): Promise<void> }> = [];

  console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  try {
    writeFileSync(oracleDbPath, '');
    writeFileSync(vectorsDbPath, '');
    process.env.ORACLE_DATA_DIR = dataDir;
    process.env.ORACLE_DB_PATH = oracleDbPath;
    process.env.ORACLE_VECTOR_DB = 'sqlite-vec';
    process.env.ORACLE_VECTOR_DB_PATH = vectorsDbPath;
    process.env.ORACLE_READ_ONLY = 'true';
    delete process.env.NEO_ARRA_API;
    delete process.env.ORACLE_API;
    delete process.env.ORACLE_HTTP_URL;
    delete process.env.ORACLE_REMOTE_WRITE_URL;
    const { OracleMCPServer } = await import('../../src/mcp/server.ts');
    servers.push(new OracleMCPServer(constructorOptions()));

    process.env.ORACLE_REMOTE_WRITE_URL = 'http://127.0.0.1:47778';
    servers.push(new OracleMCPServer(constructorOptions()));
    delete process.env.ORACLE_REMOTE_WRITE_URL;

    await Promise.all(servers.map((server) => (server as any).embeddedReady));
    expect(logs).toContain('[Oracle] Running in READ-ONLY mode');
    expect(logs).toContain(
      '[Oracle] Running in READ-ONLY mode with bounded retro-index exception (oracle_index_retro → http://127.0.0.1:47778)',
    );
  } finally {
    try {
      await Promise.all(servers.map((server) => server.cleanup()));
    } finally {
      clearEmbedderRuntimeStatusForTests();
      console.error = originalError;
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});
