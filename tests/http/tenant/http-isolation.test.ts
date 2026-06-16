import { afterAll, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { inArray } from 'drizzle-orm';
import { db, forumMessages, forumThreads, oracleDocuments, sqlite } from '../../../src/db/index.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { forumApi } from '../../../src/routes/forum/index.ts';
import { searchRoutes } from '../../../src/routes/search/index.ts';
import { createVectorDocumentsEndpoint } from '../../../src/routes/vector/documents.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const docIds = [`tenant-http-a-${stamp}`, `tenant-http-b-${stamp}`];
const threadIds: number[] = [];

function tenantRequest(app: Elysia, tenantId: string, path: string, init: RequestInit = {}) {
  return createTenantFetch((request) => app.handle(request))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

function insertSearchDoc(id: string, tenantId: string, content: string) {
  const now = Date.now();
  db.insert(oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/memory/${id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: tenantId,
    createdBy: 'tenant-test',
  }).run();
  sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(id, content, 'tenant');
}

function createVectorStore(): VectorStoreAdapter {
  const docs = [
    { id: docIds[0], document: `alpha vector ${stamp}`, metadata: { tenant_id: tenantA, type: 'learning' } },
    { id: docIds[1], document: `beta vector ${stamp}`, metadata: { tenant_id: tenantB, type: 'learning' } },
  ];
  return {
    name: 'tenant-vector',
    connect: mock(async () => {}),
    close: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    deleteCollection: mock(async () => {}),
    addDocuments: mock(async () => {}),
    query: mock(async () => ({
      ids: docs.map((doc) => doc.id),
      documents: docs.map((doc) => doc.document),
      distances: docs.map(() => 0),
      metadatas: docs.map((doc) => doc.metadata),
    })),
    queryById: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    getStats: mock(async () => ({ count: docs.length })),
    getCollectionInfo: mock(async () => ({ count: docs.length, name: 'tenant-vector' })),
    getAllEmbeddings: mock(async () => ({
      ids: docs.map((doc) => doc.id),
      documents: docs.map((doc) => doc.document),
      embeddings: docs.map(() => [0, 0, 0]),
      metadatas: docs.map((doc) => doc.metadata),
    })),
  };
}

insertSearchDoc(docIds[0], tenantA, `alpha-only-${stamp} shared-tenant-term`);
insertSearchDoc(docIds[1], tenantB, `beta-only-${stamp} shared-tenant-term`);

afterAll(() => {
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, docIds)).run();
  for (const id of docIds) sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  if (threadIds.length) {
    db.delete(forumMessages).where(inArray(forumMessages.threadId, threadIds)).run();
    db.delete(forumThreads).where(inArray(forumThreads.id, threadIds)).run();
  }
});

test('GET /api/vector/documents hides tenant B vector documents from tenant A', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorDocumentsEndpoint({ getStore: () => createVectorStore() }));
  const res = await tenantRequest(app, tenantA, '/api/vector/documents?collection=bge-m3&limit=10');
  const body = await res.json() as { items: Array<{ id: string }>; total: number };

  expect(res.status).toBe(200);
  expect(body.total).toBe(1);
  expect(body.items.map((item) => item.id)).toContain(docIds[0]);
  expect(body.items.map((item) => item.id)).not.toContain(docIds[1]);
});

test('GET /api/search hides tenant B FTS rows from tenant A', async () => {
  const res = await tenantRequest(searchRoutes, tenantA, '/api/search?q=shared-tenant-term&mode=fts');
  const body = await res.json() as { results: Array<{ id: string }> };

  expect(res.status).toBe(200);
  expect(body.results.map((item) => item.id)).toContain(docIds[0]);
  expect(body.results.map((item) => item.id)).not.toContain(docIds[1]);
});

test('forum thread HTTP endpoints hide tenant A thread from tenant B', async () => {
  const created = await tenantRequest(forumApi, tenantA, '/api/thread', {
    method: 'POST',
    body: JSON.stringify({ title: `tenant thread ${stamp}`, message: `hello ${stamp}` }),
  });
  const createdBody = await created.json() as { thread_id: number };
  threadIds.push(createdBody.thread_id);

  const denied = await tenantRequest(forumApi, tenantB, `/api/thread/${createdBody.thread_id}`);
  const listed = await tenantRequest(forumApi, tenantB, '/api/threads?limit=20');
  const allowed = await tenantRequest(forumApi, tenantA, `/api/thread/${createdBody.thread_id}`);
  const listedBody = await listed.json() as { threads: Array<{ id: number }> };

  expect(created.status).toBe(200);
  expect(denied.status).toBe(404);
  expect(allowed.status).toBe(200);
  expect(listedBody.threads.map((thread) => thread.id)).not.toContain(createdBody.thread_id);
});
