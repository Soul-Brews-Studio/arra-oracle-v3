import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), 'vector-collections-api-'));
process.env.ORACLE_DATA_DIR = root;

const vectorConfig = await import('../../../src/vector/config.ts');
const { vectorCollectionsRoutes } = await import('../../../src/routes/vector/collections.ts');
const versionedFetch = createApiVersionedFetch((request) => vectorCollectionsRoutes.handle(request));

function seedConfig() {
  const config = vectorConfig.generateDefaultConfig();
  config.dataPath = join(root, 'lance');
  config.collections = {
    phase1: {
      collection: 'phase1_collection',
      model: 'phase1-model',
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
  rmSync(root, { recursive: true, force: true });
});

test('POST, PATCH, and DELETE /api/v1/vector/collections manage vector config collections', async () => {
  seedConfig();

  const createRes = await call('/api/v1/vector/collections', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'phase2',
      collection: 'phase2_collection',
      model: 'phase2-model',
      provider: 'none',
      primary: true,
      embedder: { backend: 'none' },
    }),
  });
  expect(createRes.status).toBe(201);
  expect(createRes.body).toMatchObject({ success: true, reloaded: true, collection: 'phase2' });
  expect(createRes.body.config.collections.phase2).toMatchObject({
    collection: 'phase2_collection',
    model: 'phase2-model',
    provider: 'none',
    adapter: 'lancedb',
    primary: true,
  });
  expect(createRes.body.config.collections.phase1.primary).toBe(false);

  const duplicateRes = await call('/api/v1/vector/collections', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'phase2', model: 'dup-model' }),
  });
  expect(duplicateRes.status).toBe(409);

  const renameRes = await call('/api/v1/vector/collections/phase2', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'phase-renamed' }),
  });
  expect(renameRes.status).toBe(200);
  expect(renameRes.body.renamed).toEqual({ from: 'phase2', to: 'phase-renamed' });
  expect(renameRes.body.config.collections.phase2).toBeUndefined();
  expect(renameRes.body.config.collections['phase-renamed']).toMatchObject({
    collection: 'phase2_collection',
    model: 'phase2-model',
    primary: true,
  });

  const conflictRes = await call('/api/v1/vector/collections/phase-renamed', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newName: 'phase1' }),
  });
  expect(conflictRes.status).toBe(409);

  const persistedAfterRename = vectorConfig.loadVectorConfig(vectorConfig.configPath(root));
  expect(persistedAfterRename?.collections['phase-renamed'].collection).toBe('phase2_collection');
  expect(persistedAfterRename?.collections.phase2).toBeUndefined();

  const deleteRes = await call('/api/v1/vector/collections/phase2_collection', { method: 'DELETE' });
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.removed).toBe('phase-renamed');
  expect(deleteRes.body.config.collections['phase-renamed']).toBeUndefined();
  expect(deleteRes.body.config.collections.phase1.primary).toBe(true);

  const missingDelete = await call('/api/v1/vector/collections/missing', { method: 'DELETE' });
  expect(missingDelete.status).toBe(404);
});
