import { afterAll, expect, test } from 'bun:test';
import type { VectorDocument } from '../../../src/vector/types.ts';
import { ProxyVectorAdapter } from '../../../src/vector/adapters/proxy.ts';
import { createVectorStore } from '../../../src/vector/factory.ts';
import { vectorServiceUrl } from '../../../src/vector/registry.ts';

const requests: Array<{ method: string; path: string; body?: unknown }> = [];

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.json();
    requests.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === '/proxy/health') return Response.json({ status: 'ok', name: 'proxy-test', version: '1' });
    if (url.pathname === '/proxy/vectors/stats') return Response.json({ count: 2, name: 'remote_proxy_docs' });
    if (url.pathname === '/proxy/vectors/add') return Response.json({ success: true });
    if (url.pathname === '/proxy/vectors/query') return Response.json({
      ids: ['doc-1'], documents: ['hello'], distances: [0.1], metadatas: [{ type: 'learning' }],
    });
    if (url.pathname === '/proxy/vectors/collection') return Response.json({ success: true });
    return new Response('not found', { status: 404 });
  },
});

afterAll(() => { server.stop(true); });

test('ProxyVectorAdapter speaks vector proxy protocol under endpoint path prefixes', async () => {
  requests.length = 0;
  const adapter = new ProxyVectorAdapter('proxy_docs', `${server.url}proxy`);
  const docs: VectorDocument[] = [{ id: 'doc-1', document: 'hello', metadata: { type: 'learning' } }];

  await adapter.connect();
  await adapter.addDocuments(docs);
  const result = await adapter.query('hello', 3, { type: 'learning' });
  const info = await adapter.getCollectionInfo();
  await adapter.replaceDocuments(docs);
  await adapter.deleteCollection();

  expect(result.ids).toEqual(['doc-1']);
  expect(info).toEqual({ name: 'remote_proxy_docs', count: 2 });
  expect(requests.map((item) => `${item.method} ${item.path}`)).toEqual([
    'GET /proxy/health',
    'POST /proxy/vectors/add',
    'POST /proxy/vectors/query',
    'GET /proxy/vectors/stats',
    'DELETE /proxy/vectors/collection',
    'POST /proxy/vectors/add',
    'DELETE /proxy/vectors/collection',
  ]);
  expect(requests[2].body).toEqual({ text: 'hello', limit: 3, where: { type: 'learning' } });
  expect(requests[5].body).toEqual({ documents: docs });
});

test('vectorServiceUrl preserves path prefixes', () => {
  expect(vectorServiceUrl('http://example.test/base/', '/health')).toBe('http://example.test/base/health');
});

test('factory registers proxy vector stores', async () => {
  const adapter = createVectorStore({
    type: 'proxy',
    collectionName: 'proxy_docs',
    proxyEndpoint: `${server.url}proxy`,
  });

  expect(adapter).toBeInstanceOf(ProxyVectorAdapter);
  await expect(adapter.getCollectionInfo()).resolves.toEqual({ name: 'remote_proxy_docs', count: 2 });
});
