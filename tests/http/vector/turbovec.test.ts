import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { vectorConfigApiRoutes } from '../../../src/routes/vector/config.ts';
import { createVectorStore } from '../../../src/vector/factory.ts';
import { TurboVecAdapter } from '../../../src/vector/adapters/turbovec.ts';
import type { VectorDocument } from '../../../src/vector/types.ts';

const requests: Array<{ method: string; path: string; body?: unknown }> = [];
const savedUrl = process.env.ORACLE_TURBOVEC_URL;

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.json();
    requests.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === '/turbo/health') return Response.json({ status: 'ok', name: 'turbovec-test', version: '1' });
    if (url.pathname === '/turbo/vectors/stats') return Response.json({ count: 3, name: 'turbo_docs' });
    if (url.pathname === '/turbo/vectors/add') return Response.json({ success: true, count: 1 });
    if (url.pathname === '/turbo/vectors/query') return Response.json({
      ids: ['doc-1'], documents: ['hello turbo'], distances: [0.05], metadatas: [{ type: 'learning' }],
    });
    if (url.pathname === '/turbo/vectors/collection') return Response.json({ success: true });
    return new Response('not found', { status: 404 });
  },
});

afterAll(() => {
  server.stop(true);
  if (savedUrl === undefined) delete process.env.ORACLE_TURBOVEC_URL;
  else process.env.ORACLE_TURBOVEC_URL = savedUrl;
});

test('TurboVecAdapter forwards vector operations to a TurboVec sidecar', async () => {
  requests.length = 0;
  const adapter = new TurboVecAdapter('turbo_docs', `${server.url}turbo`);
  const docs: VectorDocument[] = [{ id: 'doc-1', document: 'hello turbo', metadata: { type: 'learning' }, vector: [1, 2, 3] }];

  await adapter.connect();
  await adapter.addDocuments(docs);
  const result = await adapter.query('hello', 2, { type: 'learning' });
  const byId = await adapter.queryById('doc-1', 1);
  const info = await adapter.getCollectionInfo();
  await adapter.deleteCollection();

  expect(adapter.name).toBe('turbovec');
  expect(result.ids).toEqual(['doc-1']);
  expect(byId.ids).toEqual(['doc-1']);
  expect(info).toEqual({ name: 'turbo_docs', count: 3 });
  expect(requests.map((item) => `${item.method} ${item.path}`)).toEqual([
    'GET /turbo/health',
    'POST /turbo/vectors/add',
    'POST /turbo/vectors/query',
    'POST /turbo/vectors/query',
    'GET /turbo/vectors/stats',
    'DELETE /turbo/vectors/collection',
  ]);
  expect(requests[1].body).toEqual({ documents: docs });
  expect(requests[2].body).toEqual({ text: 'hello', limit: 2, where: { type: 'learning' } });
  expect(requests[3].body).toEqual({ text: '', limit: 1, where: { id: 'doc-1' } });
});

test('factory registers turbovec vector stores with endpoint env fallback', async () => {
  process.env.ORACLE_TURBOVEC_URL = `${server.url}turbo`;
  const adapter = createVectorStore({ type: 'turbovec', collectionName: 'turbo_docs' });

  expect(adapter).toBeInstanceOf(TurboVecAdapter);
  await expect(adapter.getCollectionInfo()).resolves.toEqual({ name: 'turbo_docs', count: 3 });
});

test('config API accepts turbovec as a collection adapter', async () => {
  const app = new Elysia().use(vectorConfigApiRoutes);
  const fetcher = createApiVersionedFetch((request) => app.handle(request));
  const res = await fetcher(new Request('http://local/api/v1/vector/config/turbo', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapter: 'turbovec', endpoint: `${server.url}turbo` }),
  }));

  expect(res.status).not.toBe(422);
});
