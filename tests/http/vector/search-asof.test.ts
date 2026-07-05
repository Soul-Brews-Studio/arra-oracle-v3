import { Database } from 'bun:sqlite';
import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorSearchEndpoint } from '../../../src/routes/vector/search.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

function temporalDb(): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, valid_time,
      updated_at, created_at, indexed_at, superseded_by TEXT, superseded_at
    );
  `);
  return db;
}

function seed(db: Database, id: string, validTime: string) {
  const ms = Date.parse(validTime);
  db.prepare(`
    INSERT INTO oracle_documents
      (id, tenant_id, valid_time, updated_at, created_at, indexed_at)
    VALUES (?, 'default', ?, ?, ?, ?)
  `).run(id, ms, ms, ms, ms);
}

function createFetch(db: Database, queryImpl?: () => Promise<VectorQueryResult>) {
  const result: VectorQueryResult = {
    ids: ['past', 'future'],
    documents: ['past fact', 'future fact'],
    distances: [0.1, 0.2],
    metadatas: [
      { type: 'learning', source_file: 'notes/past.md', concepts: 'history' },
      { type: 'learning', source_file: 'notes/future.md', concepts: 'roadmap' },
    ],
  };
  const store = {
    connect: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    query: mock(queryImpl ?? (async () => result)),
    close: mock(async () => {}),
  };
  const app = new Elysia({ prefix: '/api' }).use(createVectorSearchEndpoint({
    asOfDb: db,
    getModels: () => ({ 'bge-m3': {} }),
    getStore: () => store,
  }));
  return { fetcher: createApiVersionedFetch((request) => app.handle(request)), store };
}

test('GET /api/v1/vector/search filters vector hits by asOf valid_time', async () => {
  const db = temporalDb();
  try {
    seed(db, 'past', '2024-01-01T00:00:00.000Z');
    seed(db, 'future', '2025-01-01T00:00:00.000Z');
    const { fetcher, store } = createFetch(db);

    const res = await fetcher(new Request(
      'http://local/api/v1/vector/search?q=oracle&asOf=2024-06-01T00:00:00.000Z&sort=id',
    ));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(store.query).toHaveBeenCalledWith('oracle', 50, undefined);
    expect(body.asOf).toBe('2024-06-01T00:00:00.000Z');
    expect(body.asOfSupportedEndpoints).toEqual(['/api/search', '/api/list', '/api/vector/search']);
    expect(body.total).toBe(1);
    expect(body.results).toEqual([expect.objectContaining({
      id: 'past',
      valid_time: '2024-01-01T00:00:00.000Z',
      valid_until: null,
    })]);
  } finally {
    db.close();
  }
});

test('GET /api/v1/vector/search rejects invalid asOf before querying the vector store', async () => {
  const db = temporalDb();
  try {
    const { fetcher, store } = createFetch(db);
    const res = await fetcher(new Request('http://local/api/v1/vector/search?q=oracle&asOf=not-a-date'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid asOf timestamp' });
    expect(store.query).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
