import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { closeCachedVectorStores, getVectorStoreByModel } from '../../../src/vector/factory.ts';

type ProxyHarness = {
  endpoint: string;
  hits: string[];
  stop: () => void;
};

const savedEnv = {
  dataDir: process.env.ORACLE_DATA_DIR,
  healthTimeout: process.env.ORACLE_VECTOR_HEALTH_TIMEOUT,
};
const root = mkdtempSync(join(tmpdir(), 'vector-config-hot-reload-'));
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_VECTOR_HEALTH_TIMEOUT = '500';

const oldProxy = startProxy('old-proxy', 11);
const newProxy = startProxy('new-proxy', 22);
const vectorConfig = await import('../../../src/vector/config.ts');
const { vectorConfigEndpoint } = await import('../../../src/routes/vector/config.ts');
const { vectorDocumentsEndpoint } = await import('../../../src/routes/vector/documents.ts');
const app = new Elysia({ prefix: '/api' })
  .use(vectorDocumentsEndpoint)
  .use(vectorConfigEndpoint);
const versionedFetch = createApiVersionedFetch((request) => app.handle(request));

function startProxy(name: string, count: number): ProxyHarness {
  const hits: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      hits.push(path);
      if (path === '/health') return Response.json({ status: 'ok', name, version: 'test' });
      if (path === '/vectors/stats') return Response.json({ count, name });
      if (path === '/vectors/query') {
        return Response.json({ ids: [], documents: [], distances: [], metadatas: [] });
      }
      return new Response('missing', { status: 404 });
    },
  });
  return {
    endpoint: String(server.url).replace(/\/$/, ''),
    hits,
    stop: () => server.stop(true),
  };
}

function seedConfig(endpoint: string) {
  const config = vectorConfig.generateDefaultConfig();
  config.dataPath = join(root, 'lancedb');
  config.collections = {
    phase1: {
      collection: 'phase1_collection',
      model: 'phase1-model',
      provider: 'none',
      adapter: 'proxy',
      endpoint,
      primary: true,
    },
  };
  vectorConfig.writeVectorConfig(config, vectorConfig.configPath(root));
  return config;
}

async function json(path: string, init: RequestInit = {}) {
  const res = await versionedFetch(new Request(`http://local${path}`, init));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function countHits(proxy: ProxyHarness, path: string): number {
  return proxy.hits.filter((hit) => hit === path).length;
}

afterAll(async () => {
  await closeCachedVectorStores();
  oldProxy.stop();
  newProxy.stop();
  if (savedEnv.dataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedEnv.dataDir;
  if (savedEnv.healthTimeout === undefined) delete process.env.ORACLE_VECTOR_HEALTH_TIMEOUT;
  else process.env.ORACLE_VECTOR_HEALTH_TIMEOUT = savedEnv.healthTimeout;
  rmSync(root, { recursive: true, force: true });
});

test('PATCH /api/v1/vector/config hot-reloads a running adapter with new config', async () => {
  const config = seedConfig(oldProxy.endpoint);

  const before = await json('/api/v1/vector/documents?collection=phase1&limit=1');
  expect(before.status).toBe(200);
  expect(before.body.total).toBe(11);
  expect(oldProxy.hits).toContain('/health');
  const cachedBefore = getVectorStoreByModel('phase1');
  const originalClose = cachedBefore.close.bind(cachedBefore);
  let closed = 0;
  cachedBefore.close = async () => {
    closed += 1;
    await originalClose();
  };
  const oldStatsBeforePatch = countHits(oldProxy, '/vectors/stats');

  const nextCollections = {
    ...config.collections,
    phase1: {
      ...config.collections.phase1,
      collection: 'phase1_reloaded',
      model: 'phase1-reloaded-model',
      endpoint: newProxy.endpoint,
    },
  };
  const patch = await json('/api/v1/vector/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collections: nextCollections }),
  });

  expect(patch.status).toBe(200);
  expect(patch.body).toMatchObject({ success: true, reloaded: true });
  expect(patch.body.config.collections.phase1).toMatchObject({
    collection: 'phase1_reloaded',
    model: 'phase1-reloaded-model',
    endpoint: newProxy.endpoint,
  });
  expect(closed).toBe(1);
  expect(newProxy.hits).toContain('/health');
  expect(countHits(oldProxy, '/vectors/stats')).toBe(oldStatsBeforePatch);

  const after = await json('/api/v1/vector/documents?collection=phase1&limit=1');
  expect(after.status).toBe(200);
  expect(after.body.total).toBe(22);
  expect(countHits(newProxy, '/vectors/stats')).toBeGreaterThan(0);
  expect(countHits(oldProxy, '/vectors/stats')).toBe(oldStatsBeforePatch);
});
