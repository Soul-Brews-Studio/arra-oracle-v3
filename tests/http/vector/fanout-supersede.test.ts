import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { QueryCache } from '../../../src/vector/query-cache.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-fanout-supersede-'));
const supersededAt = Date.now() - 2000;
let dbModule: typeof import('../../../src/db/index.ts');
let fetcher: (request: Request) => Response | Promise<Response>;

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  const { createFanoutEndpoint } = await import('../../../src/routes/vector/fanout.ts');
  const now = Date.now();
  dbModule.db.insert(dbModule.oracleDocuments).values([{
    id: 'fanout-old-doc',
    type: 'learning',
    sourceFile: 'ψ/memory/fanout-old.md',
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    supersededBy: 'fanout-new-doc',
    supersededAt,
    supersededReason: 'fanout replacement',
  }, {
    id: 'fanout-new-doc',
    type: 'learning',
    sourceFile: 'ψ/memory/fanout-new.md',
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }]).run();
  const app = new Elysia({ prefix: '/api' }).use(createFanoutEndpoint({
    cache: new QueryCache<unknown>(),
    getModels: () => ({ local: { collection: 'local_docs', model: 'bge-m3', adapter: 'lancedb' as const } }),
    getStore: async () => ({
      query: mock(async () => ({
        ids: ['fanout-old-doc'],
        distances: [0],
        documents: ['legacy fanout result'],
        metadatas: [{ type: 'learning', source_file: 'ψ/memory/fanout-old.md' }],
      })),
    }),
  }));
  fetcher = createApiVersionedFetch((request) => app.handle(request));
});

afterAll(() => {
  dbModule?.closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('GET /api/v1/vector/fanout includes supersede status on hits', async () => {
  const res = await fetcher(new Request('http://local/api/v1/vector/fanout?q=legacy&cache=false'));
  const body = await res.json() as { results: Array<Record<string, unknown>> };

  expect(res.status).toBe(200);
  expect(body.results[0]).toMatchObject({
    id: 'fanout-old-doc',
    superseded_by: 'fanout-new-doc',
    superseded_at: new Date(supersededAt).toISOString(),
    superseded_reason: 'fanout replacement',
  });
});
