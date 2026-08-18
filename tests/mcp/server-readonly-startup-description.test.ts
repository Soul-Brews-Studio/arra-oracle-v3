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
  const unifiedRuntime = {
    routes: [],
    mcpTools: [],
    menu: [],
    cliSubcommands: [],
    servers: [],
    callMcpTool: async () => { throw new Error('no plugin tools configured'); },
    pluginStatuses: () => [],
    pluginRegistry: () => [],
    init: async () => {},
    reload: async () => {},
    stop: async () => {},
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
    unifiedRuntime,
    watchPlugins: false as const,
    installSignalHandlers: false,
  };
}

async function withReadOnlyConstructorHarness(
  run: (context: { OracleMCPServer: any; logs: string[]; servers: Array<{ cleanup(): Promise<void> }> }) => Promise<void>,
): Promise<void> {
  const originalError = console.error;
  const originalEnv = { ...process.env };
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
    await run({ OracleMCPServer, logs, servers });
  } finally {
    try {
      await Promise.all(servers.map((server) => server.cleanup()));
    } finally {
      clearEmbedderRuntimeStatusForTests();
      console.error = originalError;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, originalEnv);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
  expect(console.error).toBe(originalError);
  expect({ ...process.env }).toEqual(originalEnv);
}

function callToolHandler(server: unknown) {
  const raw = (server as any).server._requestHandlers.get('tools/call') as (request: unknown) => Promise<any>;
  return (request: any) => raw({ method: 'tools/call', ...request });
}

test('read-only startup describes strict and bounded-retro modes exactly', async () => {
  await withReadOnlyConstructorHarness(async ({ OracleMCPServer, logs, servers }) => {
    servers.push(new OracleMCPServer(constructorOptions()));

    process.env.ORACLE_REMOTE_WRITE_URL = 'http://127.0.0.1:47778';
    servers.push(new OracleMCPServer(constructorOptions()));
    delete process.env.ORACLE_REMOTE_WRITE_URL;

    await Promise.all(servers.map((server) => (server as any).embeddedReady));
    expect(logs).toContain('[Oracle] Running in READ-ONLY mode');
    expect(logs).toContain(
      '[Oracle] Running in READ-ONLY mode with bounded retro-index exception (oracle_index_retro → http://127.0.0.1:47778)',
    );
  });
});

test('bounded retro fails closed when the owner core is unavailable without invoking the local handler', async () => {
  await withReadOnlyConstructorHarness(async ({ OracleMCPServer, servers }) => {
    const { mcpToolByName } = await import('../../src/tools/mcp-manifest.ts');
    const retroTool = mcpToolByName.get('oracle_index_retro')!;
    const originalHandler = retroTool.handler;
    let localHandlerCalls = 0;
    retroTool.handler = async () => {
      localHandlerCalls += 1;
      throw new Error('local retro handler must not run');
    };

    try {
      process.env.ORACLE_REMOTE_WRITE_URL = 'http://127.0.0.1:1';
      const server = new OracleMCPServer(constructorOptions());
      servers.push(server);
      await (server as any).embeddedReady;

      const response = await callToolHandler(server)({
        params: {
          name: 'oracle_index_retro',
          arguments: { repoRoot: '/not-used', filePath: '/not-used/retro.md' },
        },
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toMatch(/Cannot reach|owner core/);
      expect(localHandlerCalls).toBe(0);
    } finally {
      retroTool.handler = originalHandler;
    }
  });
});
