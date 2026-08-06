import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';

const savedEnv = {
  dataDir: process.env.ORACLE_DATA_DIR,
  healthTimeout: process.env.ORACLE_VECTOR_HEALTH_TIMEOUT,
  ollama: process.env.OLLAMA_BASE_URL,
  gemini: process.env.GEMINI_API_KEY,
};

const root = mkdtempSync(join(tmpdir(), 'vector-section-v2-'));
let api: ReturnType<typeof Bun.serve>;
let ollama: ReturnType<typeof Bun.serve>;
let proxy: ReturnType<typeof Bun.serve>;

async function json(path: string, init: RequestInit = {}) {
  const res = await fetch(`${api.url}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function startOllamaProvider() {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/api/tags') {
        return Response.json({ models: [{ name: 'bge-m3' }, { name: 'qwen3-embedding' }] });
      }
      return new Response('missing', { status: 404 });
    },
  });
}

function startProxyVectorService() {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/health') return Response.json({ status: 'ok', name: 'turbovec-closeout', version: 'test' });
      if (path === '/vectors/stats') return Response.json({ name: 'proxy_docs', count: 2 });
      if (path === '/vectors/query') {
        const body = await request.json().catch(() => ({})) as { text?: string; limit?: number };
        const limit = Math.min(body.limit ?? 2, 2);
        return Response.json({
          ids: ['proxy-doc-1', 'proxy-doc-2'].slice(0, limit),
          documents: [`${body.text ?? 'query'} via proxy`, 'second proxy result'].slice(0, limit),
          distances: [0.05, 0.2].slice(0, limit),
          metadatas: [{ type: 'note', phase: 'proxy' }, { type: 'doc', phase: 'proxy' }].slice(0, limit),
        });
      }
      return new Response('missing', { status: 404 });
    },
  });
}

beforeAll(async () => {
  ollama = startOllamaProvider();
  proxy = startProxyVectorService();
  const proxyUrl = String(proxy.url).replace(/\/$/, '');

  process.env.ORACLE_DATA_DIR = root;
  process.env.ORACLE_VECTOR_HEALTH_TIMEOUT = '300';
  process.env.OLLAMA_BASE_URL = String(ollama.url).replace(/\/$/, '');
  process.env.GEMINI_API_KEY = 'gemini-closeout';

  const vectorConfig = await import('../../../src/vector/config.ts');
  const config = vectorConfig.generateDefaultConfig();
  config.version = '2.0';
  config.enabled = true;
  config.dataPath = join(root, 'lancedb');
  config.embedder = { default: 'ollama', fallback: 'gemini', model: 'bge-m3' };
  config.storage = {
    default: 'lancedb',
    services: {
      lancedb: { type: 'builtin' },
      'turbovec-closeout': { type: 'proxy', endpoint: proxyUrl },
    },
  };
  config.collections = {
    proxy: {
      collection: 'proxy_docs',
      model: 'qwen3-embedding',
      provider: 'remote',
      adapter: 'proxy',
      service: 'turbovec-closeout',
      primary: true,
    },
  };
  vectorConfig.writeVectorConfig(config, vectorConfig.configPath(root));

  const { vectorRoutes } = await import('../../../src/routes/vector/index.ts');
  const app = new Elysia().use(vectorRoutes);
  api = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: createApiVersionedFetch((request) => app.handle(request)),
  });
});

afterAll(async () => {
  await api?.stop(true);
  await ollama?.stop(true);
  await proxy?.stop(true);
  if (savedEnv.dataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedEnv.dataDir;
  if (savedEnv.healthTimeout === undefined) delete process.env.ORACLE_VECTOR_HEALTH_TIMEOUT;
  else process.env.ORACLE_VECTOR_HEALTH_TIMEOUT = savedEnv.healthTimeout;
  if (savedEnv.ollama === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = savedEnv.ollama;
  if (savedEnv.gemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedEnv.gemini;
  rmSync(root, { recursive: true, force: true });
});

test('Vector Section v2 closes out auto-detect, proxy, Studio UI, and polish paths', async () => {
  const providers = await json('/api/v1/vector/providers');
  expect(providers.status).toBe(200);
  expect(providers.body.providers).toContainEqual(expect.objectContaining({ type: 'ollama', status: 'available' }));
  expect(providers.body.providers).toContainEqual(expect.objectContaining({ type: 'gemini', available: true }));

  const service = await json('/api/v1/vector/services/turbovec-closeout/test', { method: 'POST' });
  expect(service.status).toBe(200);
  expect(service.body).toMatchObject({ name: 'turbovec-closeout', status: 'up', success: true });

  const collection = await json('/api/v1/vector/config/proxy/test', { method: 'POST' });
  expect(collection.status).toBe(200);
  expect(collection.body).toMatchObject({ success: true, key: 'proxy', adapter: 'proxy', count: 2 });

  const config = await json('/api/v1/vector/config');
  expect(config.status).toBe(200);
  expect(config.body.config).toMatchObject({ version: '2.0', embedder: { default: 'ollama', fallback: 'gemini' } });
  expect(config.body.collections).toContainEqual(expect.objectContaining({ key: 'proxy', ok: true }));

  const models = await json('/api/v1/vector/models');
  expect(models.status).toBe(200);
  expect(models.body.models.proxy).toMatchObject({ collection: 'proxy_docs', adapter: 'proxy', count: 2 });

  const indexStatus = await json('/api/v1/vector/index/status');
  expect(indexStatus.status).toBe(200);
  expect(indexStatus.body).toMatchObject({ status: 'idle', current: 0 });

  const fanout = await json('/api/v1/vector/fanout?q=oracle&fanout=proxy&limit=2&cache=false');
  expect(fanout.status).toBe(200);
  expect(fanout.body).toMatchObject({ query: 'oracle', backends: ['proxy'], errors: {} });
  expect(fanout.body.results).toContainEqual(expect.objectContaining({ id: 'proxy-doc-1', model: 'proxy', source: 'vector' }));

  const cost = await json('/api/v1/vector/cost-estimate?provider=gemini&tokensPerDoc=100');
  expect(cost.status).toBe(200);
  expect(cost.body).toMatchObject({ docs: 2, totalTokens: 200, collection: 'all' });
  expect(String(cost.body.recommendation)).toContain('Any configured');
});
