import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedHealthTimeout = process.env.ORACLE_VECTOR_HEALTH_TIMEOUT;
const root = mkdtempSync(join(tmpdir(), 'vector-config-api-'));
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_VECTOR_HEALTH_TIMEOUT = '1500';

const vectorConfig = await import('../../../src/vector/config.ts');
const { vectorConfigApiRoutes } = await import('../../../src/routes/vector/config.ts');

const versionedFetch = createApiVersionedFetch((request) => vectorConfigApiRoutes.handle(request));

function seedConfig() {
  const config = vectorConfig.generateDefaultConfig();
  config.dataPath = join(root, 'lance');
  config.collections = {
    phase1: {
      collection: 'phase1_collection',
      model: 'old-model',
      provider: 'none',
      adapter: 'lancedb',
      primary: true,
    },
  };
  vectorConfig.writeVectorConfig(config, vectorConfig.configPath(root));
  return config;
}

async function call(path: string, init: RequestInit = {}) {
  const res = await versionedFetch(new Request(`http://local${path}`, init));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedHealthTimeout === undefined) delete process.env.ORACLE_VECTOR_HEALTH_TIMEOUT;
  else process.env.ORACLE_VECTOR_HEALTH_TIMEOUT = savedHealthTimeout;
  rmSync(root, { recursive: true, force: true });
});

test('GET and PUT /api/v1/vector/config expose and update vector-server.json', async () => {
  seedConfig();

  const getRes = await call('/api/v1/vector/config');
  expect(getRes.status).toBe(200);
  expect(getRes.body.source).toBe('file');
  expect(getRes.body.config.collections.phase1).toMatchObject({
    collection: 'phase1_collection',
    model: 'old-model',
    provider: 'none',
    adapter: 'lancedb',
  });
  expect(getRes.body.doc_counts.phase1).toEqual(expect.any(Number));
  expect(getRes.body.health.phase1).toMatchObject({
    collection: 'phase1_collection',
    model: 'old-model',
    adapter: 'lancedb',
  });
  expect(getRes.body.collections[0].count).toEqual(expect.any(Number));
  expect(getRes.body.options.embeddingProviders).toContain('gemini');

  const testRes = await call('/api/v1/vector/config/phase1/test', { method: 'POST' });
  expect(testRes.status).toBe(200);
  expect(testRes.body).toMatchObject({
    success: true,
    key: 'phase1',
    collection: 'phase1_collection',
    adapter: 'lancedb',
  });

  const emptyUpdate = await call('/api/v1/vector/config/phase1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(emptyUpdate.status).toBe(400);

  const missing = await call('/api/v1/vector/config/missing', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'ignored' }),
  });
  expect(missing.status).toBe(404);

  const putRes = await call('/api/v1/vector/config/phase1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapter: 'qdrant', model: 'new-model', provider: 'remote' }),
  });
  expect(putRes.status).toBe(200);
  expect(putRes.body.success).toBe(true);
  expect(putRes.body.config.collections.phase1).toMatchObject({
    collection: 'phase1_collection',
    model: 'new-model',
    provider: 'remote',
    adapter: 'qdrant',
    primary: true,
  });

  const persisted = vectorConfig.loadVectorConfig(vectorConfig.configPath(root));
  expect(persisted?.collections.phase1).toMatchObject({
    model: 'new-model',
    provider: 'remote',
    adapter: 'qdrant',
  });

  const switchRes = await call('/api/v1/vector/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      collections: Object.fromEntries(Object.entries(putRes.body.config.collections).map(([key, value]) => [
        key,
        { ...(value as Record<string, unknown>), adapter: 'sqlite-vec', enabled: true },
      ])),
    }),
  });
  expect(switchRes.status).toBe(200);
  expect(switchRes.body.config.collections.phase1).toMatchObject({ adapter: 'sqlite-vec', enabled: true });
  expect(vectorConfig.loadVectorConfig(vectorConfig.configPath(root))?.collections.phase1.adapter).toBe('sqlite-vec');

  const disabledRes = await call('/api/v1/vector/config/phase1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false, provider: 'none' }),
  });
  expect(disabledRes.status).toBe(200);
  expect(disabledRes.body.config.collections.phase1).toMatchObject({ enabled: false, provider: 'none' });

  const disabledTest = await call('/api/v1/vector/config/phase1/test', { method: 'POST' });
  expect(disabledTest.status).toBe(400);
  expect(disabledTest.body).toMatchObject({ success: false, status: 'disabled', enabled: false });

  const addRes = await call('/api/v1/vector/config/phase2', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      collection: 'phase2_collection',
      model: 'phase2-model',
      primary: true,
      embedder: { backend: 'gemini', fallback: 'openai' },
    }),
  });
  expect(addRes.status).toBe(200);
  expect(addRes.body.config.collections.phase2).toMatchObject({
    collection: 'phase2_collection',
    model: 'phase2-model',
    provider: 'none',
    adapter: 'lancedb',
    primary: true,
    embedder: { backend: 'gemini', fallback: 'openai' },
  });
  expect(addRes.body.config.collections.phase1.primary).toBe(false);

  const primaryRes = await call('/api/v1/vector/config/phase1/primary', { method: 'POST' });
  expect(primaryRes.status).toBe(200);
  expect(primaryRes.body.config.collections.phase1.primary).toBe(true);
  expect(primaryRes.body.config.collections.phase2.primary).toBe(false);

  const removeRes = await call('/api/v1/vector/config/phase2', { method: 'DELETE' });
  expect(removeRes.status).toBe(200);
  expect(removeRes.body.removed).toBe('phase2');
  expect(removeRes.body.config.collections.phase2).toBeUndefined();

  const patchRes = await call('/api/v1/vector/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embedder: { default: 'ollama', fallback: 'openai' } }),
  });
  expect(patchRes.status).toBe(200);
  expect(patchRes.body).toMatchObject({ success: true, reloaded: true, source: 'file' });
  expect(patchRes.body.config.embedder).toMatchObject({ default: 'ollama', fallback: 'openai' });

  const reloadRes = await call('/api/v1/vector/config/reload', { method: 'POST' });
  expect(reloadRes.status).toBe(200);
  expect(reloadRes.body).toMatchObject({ success: true, reloaded: true, source: 'file' });
  expect(reloadRes.body.config.collections.phase1.adapter).toBe('sqlite-vec');
  expect(readdirSync(root).some((name) => name.includes('.tmp'))).toBe(false);
});
