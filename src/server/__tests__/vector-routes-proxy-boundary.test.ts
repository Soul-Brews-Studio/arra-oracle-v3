import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

const originalVectorUrl = process.env.VECTOR_URL;
const calls: string[] = [];

const remote = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname}${url.search}`);

    if (url.pathname === '/api/map') {
      return Response.json({ error: 'remote map down' }, { status: 500 });
    }
    if (url.pathname === '/api/map3d') {
      return Response.json({
        documents: [],
        total: 3,
        pca_info: { variance_explained: [], n_vectors: 0, n_dimensions: 0, computed_at: 'now' },
      });
    }
    if (url.pathname === '/api/vector/index/start') {
      return Response.json({ status: 'started', received: await req.json() });
    }
    if (url.pathname === '/api/vector/index/status') {
      return Response.json({ status: 'completed', source: 'vault', current: 1, total: 1 });
    }
    if (url.pathname === '/api/vector/index/stop') {
      return Response.json({ status: 'stopping', stopped: true });
    }
    if (url.pathname === '/api/vector/index/models') {
      return Response.json({ models: { 'bge-m3': { count: 1, adapter: 'lancedb' } } });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  },
});

process.env.VECTOR_URL = `http://127.0.0.1:${remote.port}`;

const { mapEndpoint } = await import('../../routes/vector/map.ts');
const { map3dEndpoint } = await import('../../routes/vector/map3d.ts');
const { vectorIndexerEndpoints } = await import('../../routes/vector/indexer.ts');

const app = new Elysia({ prefix: '/api' })
  .use(mapEndpoint)
  .use(map3dEndpoint)
  .use(vectorIndexerEndpoints);

describe('VECTOR_URL route boundary', () => {
  test('/api/map returns proxy 503 instead of local vector fallback', async () => {
    const res = await app.handle(new Request('http://localhost/api/map'));
    const body = await res.json() as { error: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe('Vector proxy unavailable');
    expect(calls).toContain('GET /api/map');
  });

  test('/api/map3d proxies to the remote vector sidecar', async () => {
    const res = await app.handle(new Request('http://localhost/api/map3d?model=bge-m3'));
    const body = await res.json() as { total: number };

    expect(res.status).toBe(200);
    expect(body.total).toBe(3);
    expect(calls).toContain('GET /api/map3d?model=bge-m3');
  });

  test('/api/vector/index/* proxies to the remote vector sidecar', async () => {
    const start = await app.handle(new Request('http://localhost/api/vector/index/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'vault', repoRoot: '/tmp/vault' }),
    }));
    const startBody = await start.json() as { received: { source: string; repoRoot: string } };
    expect(start.status).toBe(200);
    expect(startBody.received).toEqual({ source: 'vault', repoRoot: '/tmp/vault' });

    const status = await app.handle(new Request('http://localhost/api/vector/index/status'));
    expect((await status.json() as { source: string }).source).toBe('vault');

    const stop = await app.handle(new Request('http://localhost/api/vector/index/stop', { method: 'POST' }));
    expect((await stop.json() as { stopped: boolean }).stopped).toBe(true);

    const models = await app.handle(new Request('http://localhost/api/vector/index/models'));
    expect((await models.json() as { models: Record<string, unknown> }).models['bge-m3']).toBeDefined();
    expect(calls).toContain('POST /api/vector/index/start');
    expect(calls).toContain('GET /api/vector/index/status');
    expect(calls).toContain('POST /api/vector/index/stop');
    expect(calls).toContain('GET /api/vector/index/models');
  });
});

afterAll(() => {
  remote.stop(true);
  if (originalVectorUrl !== undefined) process.env.VECTOR_URL = originalVectorUrl;
  else delete process.env.VECTOR_URL;
});
