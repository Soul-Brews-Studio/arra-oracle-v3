import { afterAll, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import type { VectorStoreAdapter, VectorDocument } from '../../../src/vector/types.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const isolatedDataDir = mkdtempSync(join(tmpdir(), 'indexer-http-'));
process.env.ORACLE_DATA_DIR = isolatedDataDir;

const { createStartRoute } = await import('../../../src/routes/indexer/start.ts');
const { indexerRoutes } = await import('../../../src/routes/indexer/index.ts');

afterAll(() => {
  rmSync(isolatedDataDir, { recursive: true, force: true });
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
});

function request(path: string, init: RequestInit = {}) {
  return indexerRoutes.handle(new Request(`http://local${path}`, init));
}

function post(path: string, body: unknown, fetcher = request) {
  return fetcher(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('indexer HTTP routes', () => {
  test('GET /api/indexer/config returns adapters and model metadata', async () => {
    const res = await request('/api/indexer/config');
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.adapters)).toBe(true);
    expect(body.adapters).toContain('lancedb');
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
  });

  test('POST /api/indexer/scan reports markdown files by type', async () => {
    const root = join(tmpdir(), `indexer-scan-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const learnDir = join(root, 'memory', 'learnings');
    mkdirSync(learnDir, { recursive: true });
    writeFileSync(join(learnDir, 'lesson.md'), '# Lesson\n\nBody');
    writeFileSync(join(learnDir, 'skip.txt'), 'not markdown');

    try {
      const res = await post('/api/indexer/scan', { sourcePath: root, types: ['learning'] });
      const body = await res.json() as Record<string, any>;

      expect(res.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.byType.learning).toBe(1);
      expect(body.files[0].relativePath).toContain('lesson.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('POST /api/indexer/scan returns empty payload for missing path', async () => {
    const missing = join(tmpdir(), `missing-indexer-${Date.now()}`);
    const res = await post('/api/indexer/scan', { sourcePath: missing });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.error).toContain('Path not found');
    expect(body.total).toBe(0);
    expect(body.files).toEqual([]);
  });

  test('POST /api/indexer/stop toggles the stop contract', async () => {
    const res = await post('/api/indexer/stop', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: true });
  });

  test('POST /api/indexer/start returns 503 when no embedding models are configured', async () => {
    const app = new Elysia({ prefix: '/api' }).use(createStartRoute({ getModels: () => ({} as any) }));
    const res = await post('/api/indexer/start', {}, (path, init) => app.handle(new Request(`http://local${path}`, init)));
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(503);
    expect(body).toEqual({ status: 'error', error: 'No embedding models configured' });
  });

  test('POST /api/indexer/start normalizes bad batch size and closes failed stores', async () => {
    const sqlite = tenantIndexerDb();
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    seedDoc(sqlite, `idx-fail-${stamp}`, 'default', `alpha ${stamp}`, 1);
    const close = mock(async () => {});
    const tasks: Promise<void>[] = [];
    const app = new Elysia({ prefix: '/api' }).use(createStartRoute({
      createDb: () => ({ sqlite } as any),
      createStore: () => ({ ...fakeStore([]), close, addDocuments: mock(async () => { throw new Error('embed failed'); }) }),
      getModels: () => ({ nomic: { collection: 'test', model: 'nomic-embed-text' } } as any),
      runInBackground: (task) => tasks.push(task),
    }));

    try {
      const res = await post('/api/indexer/start', { model: 'nomic', batchSize: -3 }, (path, init) => app.handle(new Request(`http://local${path}`, init)));
      const body = await res.json() as Record<string, unknown>;
      await Promise.all(tasks);
      const status = sqlite.prepare('SELECT error FROM indexing_status WHERE id = 1').get() as any;

      expect(res.status).toBe(200);
      expect(body.batchSize).toBe(100);
      expect(status.error).toBe('embed failed');
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      sqlite.close();
    }
  });

  test('POST /api/indexer/start scopes vector indexing by tenant', async () => {
    const sqlite = tenantIndexerDb();
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantA = `tenant-a-${stamp}`;
    const tenantB = `tenant-b-${stamp}`;
    seedDoc(sqlite, `idx-a-${stamp}`, tenantA, `Alpha Project ${stamp}`, 2);
    seedDoc(sqlite, `idx-b-${stamp}`, tenantB, `beta ${stamp}`, 1);
    const added: VectorDocument[] = [];
    const entityDocs: VectorDocument[] = [];
    const tasks: Promise<void>[] = [];
    const app = new Elysia({ prefix: '/api' }).use(createStartRoute({
      createDb: () => ({ sqlite } as any),
      createStore: (preset: any) => fakeStore(String(preset.collection).endsWith('_entities') ? entityDocs : added),
      getModels: () => ({ nomic: { collection: 'test', model: 'nomic-embed-text' } }),
      runInBackground: (task) => tasks.push(task),
    }));

    try {
      const res = await createTenantFetch((request) => app.handle(request))(new Request('http://local/api/indexer/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantA },
        body: JSON.stringify({ model: 'nomic', batchSize: 10 }),
      }));
      const body = await res.json() as Record<string, unknown>;
      await Promise.all(tasks);
      const status = sqlite.prepare('SELECT progress_total FROM indexing_status WHERE id = 1').get() as any;

      expect(res.status).toBe(200);
      expect(body.tenantId).toBe(tenantA);
      expect(added.map((doc) => doc.id)).toEqual([`idx-a-${stamp}`]);
      expect(added[0].document).toContain('Alpha Project');
      expect(added[0].metadata.tenant_id).toBe(tenantA);
      expect(entityDocs.map((doc) => doc.document)).toContain('Alpha Project');
      expect(entityDocs[0].metadata.source_doc_id).toBe(`idx-a-${stamp}`);
      expect(entityDocs[0].metadata.tenant_id).toBe(tenantA);
      expect(status.progress_total).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  test('POST /api/indexer/start skips unchanged chunks on re-run', async () => {
    const sqlite = tenantIndexerDb();
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    seedDoc(sqlite, `idx-inc-${stamp}`, 'default', `Stable Project ${stamp}`, 1);
    const added: VectorDocument[] = [];
    let embedded = 0;
    const tasks: Promise<void>[] = [];
    const app = new Elysia({ prefix: '/api' }).use(createStartRoute({
      createDb: () => ({ sqlite } as any),
      createStore: (preset: any) => {
        const store = fakeStore(String(preset.collection).endsWith('_entities') ? [] : added);
        if (!String(preset.collection).endsWith('_entities')) {
          const add = store.addDocuments;
          store.addDocuments = async (docs) => { embedded += docs.length; await add(docs); };
        }
        return store;
      },
      getModels: () => ({ nomic: { collection: 'test', model: 'nomic-embed-text' } }),
      runInBackground: (task) => tasks.push(task),
    }));

    try {
      const run = async () => {
        const res = await post('/api/indexer/start', { model: 'nomic', batchSize: 10 }, (path, init) => app.handle(new Request(`http://local${path}`, init)));
        await Promise.all(tasks.splice(0));
        expect(res.status).toBe(200);
      };
      await run();
      expect(embedded).toBe(1);
      await run();
      expect(embedded).toBe(1);
      expect(added.map((doc) => doc.id)).toEqual([`idx-inc-${stamp}`]);
    } finally {
      sqlite.close();
    }
  });
});

function tenantIndexerDb() {
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
    CREATE TABLE vector_index_manifest (
      id TEXT PRIMARY KEY, chunk_id TEXT NOT NULL, source_file TEXT NOT NULL,
      model_key TEXT NOT NULL, content_hash TEXT NOT NULL, updated_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL
    );
    INSERT INTO indexing_status (id, is_indexing) VALUES (1, 0);
  `);
  return sqlite;
}

function seedDoc(sqlite: Database, id: string, tenantId: string, content: string, createdAt: number) {
  sqlite.prepare(`
    INSERT INTO oracle_documents
      (id, tenant_id, type, source_file, concepts, project, created_at)
    VALUES (?, ?, 'learning', ?, '[]', ?, ?)
  `).run(id, tenantId, `ψ/${id}.md`, tenantId, createdAt);
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(id, content, 'tenant');
}

function fakeStore(added: VectorDocument[]): VectorStoreAdapter {
  return {
    name: 'fake-indexer-store',
    connect: async () => {}, close: async () => {}, ensureCollection: async () => {},
    deleteCollection: async () => { added.splice(0, added.length); },
    addDocuments: async (docs) => { added.push(...docs); },
    deleteDocuments: async (ids) => {
      for (const id of ids) {
        const index = added.findIndex((doc) => doc.id === id);
        if (index >= 0) added.splice(index, 1);
      }
    },
    query: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    queryById: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    getStats: async () => ({ count: added.length }),
    getCollectionInfo: async () => ({ count: added.length, name: 'fake-indexer-store' }),
  };
}
