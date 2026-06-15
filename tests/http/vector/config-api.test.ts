import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
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
const { vectorConfigApiEndpoint } = await import('../../../src/routes/vector/config-api.ts');

const app = new Elysia({ prefix: '/api' }).use(vectorConfigApiEndpoint);
const versionedFetch = createApiVersionedFetch((request) => app.handle(request));

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
  expect(readdirSync(root).some((name) => name.includes('.tmp'))).toBe(false);
});
