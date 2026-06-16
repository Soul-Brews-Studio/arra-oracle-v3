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
  openai: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
};

const root = mkdtempSync(join(tmpdir(), 'vector-integration-smoke-'));
let api: ReturnType<typeof Bun.serve>;
let ollama: ReturnType<typeof Bun.serve>;

async function json(path: string, init: RequestInit = {}) {
  const res = await fetch(`${api.url}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

beforeAll(async () => {
  ollama = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api/tags') {
        return Response.json({ models: [{ name: 'bge-m3' }, { name: 'nomic-embed-text' }] });
      }
      return new Response('missing', { status: 404 });
    },
  });

  process.env.ORACLE_DATA_DIR = root;
  process.env.ORACLE_VECTOR_HEALTH_TIMEOUT = '300';
  process.env.OLLAMA_BASE_URL = String(ollama.url).replace(/\/$/, '');
  process.env.OPENAI_API_KEY = 'sk-smoke';
  process.env.GEMINI_API_KEY = 'gemini-smoke';

  const vectorConfig = await import('../../../src/vector/config.ts');
  const config = vectorConfig.generateDefaultConfig();
  config.dataPath = join(root, 'lancedb');
  config.collections = {
    smoke: {
      collection: 'smoke_collection',
      model: 'bge-m3',
      provider: 'none',
      adapter: 'lancedb',
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
  if (savedEnv.dataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedEnv.dataDir;
  if (savedEnv.healthTimeout === undefined) delete process.env.ORACLE_VECTOR_HEALTH_TIMEOUT;
  else process.env.ORACLE_VECTOR_HEALTH_TIMEOUT = savedEnv.healthTimeout;
  if (savedEnv.ollama === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = savedEnv.ollama;
  if (savedEnv.openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedEnv.openai;
  if (savedEnv.gemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedEnv.gemini;
  rmSync(root, { recursive: true, force: true });
});

test('Vector Section v2 phases smoke through HTTP server', async () => {
  const providers = await json('/api/v1/vector/providers');
  expect(providers.status).toBe(200);
  expect(providers.body.providers).toContainEqual(expect.objectContaining({
    type: 'ollama', status: 'available', models: ['bge-m3', 'nomic-embed-text'],
  }));
  expect(providers.body.providers).toContainEqual(expect.objectContaining({ type: 'gemini', available: true }));

  const configPatch = await json('/api/v1/vector/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embedder: { default: 'ollama', fallback: 'gemini' } }),
  });
  expect(configPatch.status).toBe(200);
  expect(configPatch.body).toMatchObject({ success: true, reloaded: true });
  expect(configPatch.body.config.embedder).toMatchObject({ default: 'ollama', fallback: 'gemini' });

  const registered = await json('/api/v1/vector/services/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'turbovec-smoke', type: 'proxy', endpoint: 'http://127.0.0.1:9' }),
  });
  expect(registered.status).toBe(200);
  expect(registered.body).toMatchObject({ success: true, service: { name: 'turbovec-smoke' } });

  const services = await json('/api/v1/vector/services');
  expect(services.status).toBe(200);
  expect(services.body.services).toContainEqual(expect.objectContaining({ name: 'lancedb', type: 'builtin' }));
  expect(services.body.services).toContainEqual(expect.objectContaining({ name: 'turbovec-smoke', type: 'proxy' }));

  const models = await json('/api/v1/vector/models');
  expect(models.status).toBe(200);
  expect(models.body.models.smoke).toMatchObject({ collection: 'smoke_collection', adapter: 'lancedb' });

  const indexStatus = await json('/api/v1/vector/index/status');
  expect(indexStatus.status).toBe(200);
  expect(indexStatus.body).toMatchObject({ status: 'idle', current: 0 });

  const compare = await json('/api/v1/compare?q=oracle&models=smoke&limit=2');
  expect(compare.status).toBe(200);
  expect(compare.body).toMatchObject({ query: 'oracle', models: ['smoke'] });
  expect(compare.body.agreement).toEqual(expect.objectContaining({ top1: expect.any(Number) }));

  const formats = await json('/api/v1/vector/export/formats');
  expect(formats.status).toBe(200);
  expect(formats.body.formats.map((item: { format: string }) => item.format)).toContain('jsonl');
});
