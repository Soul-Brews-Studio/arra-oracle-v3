import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

await import('../../../src/config.ts');

const scratch = mkdtempSync(join(tmpdir(), 'old-studio-endpoints-'));
const originalEnv = {
  dataDir: process.env.ORACLE_DATA_DIR,
  dbPath: process.env.ORACLE_DB_PATH,
  embedder: process.env.ORACLE_EMBEDDER,
  vectorDb: process.env.ORACLE_VECTOR_DB,
  apiKey: process.env.ARRA_API_KEY,
  apiToken: process.env.ARRA_API_TOKEN,
};
process.env.ORACLE_DATA_DIR = scratch;
process.env.ORACLE_DB_PATH = join(scratch, 'oracle.db');
process.env.ORACLE_EMBEDDER = 'none';
process.env.ORACLE_VECTOR_DB = 'sqlite-vec';
delete process.env.ARRA_API_KEY;
delete process.env.ARRA_API_TOKEN;

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);

const { createApp } = await import('../../../src/server.ts');
const { createHealthEndpoint } = await import('../../../src/routes/health/health.ts');
const { createStatsEndpoint } = await import('../../../src/routes/health/stats.ts');
const { filesRouter } = await import('../../../src/routes/files/index.ts');
const { createMenuRoutes } = await import('../../../src/routes/menu/index.ts');
const { vectorRoutes } = await import('../../../src/routes/vector/index.ts');
const { oldStudioCompatRoutes } = await import('../../../src/routes/compat.ts');
const { searchRoutes } = await import('../../../src/routes/search/index.ts');
const { configEndpoint } = await import('../../../src/routes/indexer/config.ts');
const { scanEndpoint } = await import('../../../src/routes/indexer/scan.ts');
const { createStartRoute } = await import('../../../src/routes/indexer/start.ts');
const { progressEndpoint } = await import('../../../src/routes/indexer/progress.ts');
const { stopEndpoint } = await import('../../../src/routes/indexer/stop.ts');
const { createApiVersionedFetch } = await import('../../../src/middleware/api-version.ts');

type Endpoint = { method: string; path: string; body?: unknown; expectJson?: boolean };

const oldStudioEndpoints: Endpoint[] = [
  { method: 'GET', path: '/api/health', expectJson: true },
  { method: 'GET', path: '/api/stats', expectJson: true },
  { method: 'GET', path: '/api/graph', expectJson: true },
  { method: 'GET', path: '/api/menu', expectJson: true },
  { method: 'GET', path: '/api/map3d', expectJson: true },
  { method: 'GET', path: '/api/sessions', expectJson: true },
  { method: 'POST', path: '/api/capture', body: {}, expectJson: true },
  { method: 'POST', path: '/api/send', body: { target: 'codex-4', text: 'ping' }, expectJson: true },
  { method: 'GET', path: '/api/indexer/config', expectJson: true },
  { method: 'GET', path: '/api/indexer/progress' },
  { method: 'POST', path: '/api/indexer/scan', body: { sourcePath: join(scratch, 'missing') }, expectJson: true },
  { method: 'POST', path: '/api/indexer/start', body: { model: 'nomic', batchSize: 1 }, expectJson: true },
  { method: 'POST', path: '/api/indexer/stop', body: {}, expectJson: true },
  { method: 'GET', path: '/api/reflect', expectJson: true },
];

function runtime() {
  return {
    pluginCount: 0,
    routes: [],
    mcpTools: [],
    menu: [],
    cliSubcommands: [],
    servers: [],
    callMcpTool: async () => ({}),
    pluginStatuses: () => [],
    pluginRegistry: () => [],
    init: async () => {},
    reload: async () => {},
    stop: async () => {},
  } as any;
}

function vectorHealth() {
  return Promise.resolve({
    status: 'ok' as const,
    engines: [],
    collections: [],
    checked_at: '2026-07-03T00:00:00.000Z',
  });
}

function auditApp() {
  const tasks: Promise<void>[] = [];
  const sqlite = indexerDb();
  const indexerAuditRoutes = new Elysia({ prefix: '/api' })
    .use(configEndpoint)
    .use(scanEndpoint)
    .use(createStartRoute({
      createDb: () => ({ sqlite } as any),
      createStore: () => fakeStore(),
      getModels: () => ({ nomic: { collection: 'test', model: 'nomic-embed-text' } } as any),
      runInBackground: (task) => tasks.push(task),
    }))
    .use(progressEndpoint)
    .use(stopEndpoint);

  const app = new Elysia()
    .use(new Elysia({ prefix: '/api' })
      .use(createHealthEndpoint({ vectorHealth, vectorServerHealth: async () => ({ configured: false, status: 'ok' }), pluginStatuses: () => [] }))
      .use(createStatsEndpoint({ vectorStats: async () => ({ vector: { enabled: false, count: 0, collection: 'oracle_knowledge' }, vectors: [] }) })))
    .use(filesRouter)
    .use(createMenuRoutes([]))
    .use(vectorRoutes)
    .use(oldStudioCompatRoutes)
    .use(indexerAuditRoutes)
    .use(searchRoutes);

  return { app, close: async () => { await Promise.all(tasks); sqlite.close(); } };
}

function request(app: Elysia, endpoint: Endpoint) {
  const headers: Record<string, string> = { origin: 'https://studio.buildwithoracle.com' };
  const init: RequestInit = { method: endpoint.method, headers };
  if (endpoint.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(endpoint.body);
  }
  return createApiVersionedFetch((req) => app.handle(req))(new Request(`http://local${endpoint.path}`, init));
}

describe('old Studio endpoint compatibility', () => {
  test('server composition mounts handlers for every old Studio endpoint', () => {
    const app = createApp({ unifiedPlugins: runtime(), dataDir: scratch, vectorUrl: '' });
    const routes = new Set(app.routes.map((route) => `${route.method} ${route.path}`));

    for (const endpoint of oldStudioEndpoints) {
      expect(routes).toContain(`${endpoint.method} ${endpoint.path}`);
    }
    expect(routes).toContain('GET /api/capture');
  });

  test('old Studio endpoints respond without 404 or handler crashes', async () => {
    const { app, close } = auditApp();
    try {
      for (const endpoint of oldStudioEndpoints) {
        const res = await request(app, endpoint);
        const payload = await res.text();

        expect(res.status, `${endpoint.method} ${endpoint.path}`).not.toBe(404);
        expect(res.status, `${endpoint.method} ${endpoint.path}`).toBeLessThan(500);
        expect(payload.length, `${endpoint.method} ${endpoint.path}`).toBeGreaterThan(0);
        if (endpoint.expectJson) expect(() => JSON.parse(payload)).not.toThrow();
      }
    } finally {
      await close();
    }
  });
});

function indexerDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, type TEXT NOT NULL,
      source_file TEXT NOT NULL, concepts TEXT NOT NULL, project TEXT,
      created_at INTEGER NOT NULL, usage_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER
    );
    CREATE TABLE oracle_fts (id TEXT, content TEXT, concepts TEXT);
    CREATE TABLE indexing_status (
      id INTEGER PRIMARY KEY, is_indexing INTEGER DEFAULT 0 NOT NULL,
      progress_current INTEGER DEFAULT 0, progress_total INTEGER DEFAULT 0,
      started_at INTEGER, completed_at INTEGER, error TEXT, repo_root TEXT
    );
    INSERT INTO indexing_status (id, is_indexing) VALUES (1, 0);
  `);
  return sqlite;
}

function fakeStore() {
  return {
    name: 'fake-studio-audit-store',
    connect: async () => {},
    close: async () => {},
    ensureCollection: async () => {},
    deleteCollection: async () => {},
    addDocuments: async () => {},
    query: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    queryById: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    getStats: async () => ({ count: 0 }),
    getCollectionInfo: async () => ({ count: 0, name: 'fake-studio-audit-store' }),
  } as any;
}

afterAll(() => {
  dbModule.closeDb();
  if (originalEnv.dataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = originalEnv.dataDir;
  if (originalEnv.dbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = originalEnv.dbPath;
  if (originalEnv.embedder === undefined) delete process.env.ORACLE_EMBEDDER;
  else process.env.ORACLE_EMBEDDER = originalEnv.embedder;
  if (originalEnv.vectorDb === undefined) delete process.env.ORACLE_VECTOR_DB;
  else process.env.ORACLE_VECTOR_DB = originalEnv.vectorDb;
  if (originalEnv.apiKey === undefined) delete process.env.ARRA_API_KEY;
  else process.env.ARRA_API_KEY = originalEnv.apiKey;
  if (originalEnv.apiToken === undefined) delete process.env.ARRA_API_TOKEN;
  else process.env.ARRA_API_TOKEN = originalEnv.apiToken;
  rmSync(scratch, { recursive: true });
});
