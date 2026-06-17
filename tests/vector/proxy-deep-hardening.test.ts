import { expect, test } from 'bun:test';
import { ProxyVectorAdapter } from '../../src/vector/adapters/proxy.ts';
import { buildVectorProxyUrl } from '../../src/vector/proxy-protocol.ts';
import { startServer } from './helpers.ts';

test('proxy protocol trims endpoint and rejects blank endpoints', () => {
  expect(buildVectorProxyUrl(' https://vector.example/base/ ', 'vectors/query'))
    .toBe('https://vector.example/base/vectors/query');
  expect(() => buildVectorProxyUrl('   ', '/health')).toThrow('Vector proxy endpoint is required');
});

test('proxy adapter skips empty add batches and normalizes stats/query edges', async () => {
  let addHits = 0;
  let queryPayload: unknown;
  const target = startServer(async (req) => {
    const path = new URL(req.url).pathname;
    if (path === '/vectors/add') {
      addHits += 1;
      return Response.json({ ok: true });
    }
    if (path === '/vectors/stats') return Response.json({ count: -2, name: '   ' });
    if (path === '/vectors/query') {
      queryPayload = await req.json();
      return Response.json({ ids: [], documents: [], distances: [], metadatas: [] });
    }
    return Response.json({ status: 'ok', name: 'proxy', version: 'test' });
  });
  const adapter = new ProxyVectorAdapter('docs', ` ${target}/ `);

  await adapter.addDocuments([]);
  const info = await adapter.getCollectionInfo();
  await adapter.query('oracle', Number.NaN);

  expect(addHits).toBe(0);
  expect(info).toEqual({ name: 'docs', count: 0 });
  expect(queryPayload).toMatchObject({ text: 'oracle', limit: 10 });
});

test('proxy adapter caps oversized query and export limits', async () => {
  const paths: string[] = [];
  let queryPayload: any;
  const target = startServer(async (req) => {
    const url = new URL(req.url);
    paths.push(`${req.method} ${url.pathname}${url.search}`);
    if (url.pathname === '/vectors/query') {
      queryPayload = await req.json();
      return Response.json({ ids: [], documents: [], distances: [], metadatas: [] });
    }
    if (url.pathname === '/vectors/export') {
      return Response.json({ ids: [], embeddings: [], metadatas: [], documents: [] });
    }
    return Response.json({ status: 'ok', name: 'proxy', version: 'test' });
  });
  const adapter = new ProxyVectorAdapter('docs', target);

  await adapter.query('oracle', 999999);
  await adapter.getAllEmbeddings(999999);

  expect(queryPayload.limit).toBe(1000);
  expect(paths).toContain('GET /vectors/export?limit=1000');
});
