import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../../src/vector/adapter.ts';
import { withEmbedderIdentityGuard } from '../../src/vector/embedder-identity.ts';
import { tempDir } from './helpers.ts';

function memoryAdapter(): VectorStoreAdapter & { deleted: boolean } {
  return {
    name: 'memory',
    deleted: false,
    async connect() {},
    async close() {},
    async ensureCollection() {},
    async deleteCollection() { this.deleted = true; },
    async addDocuments(_docs: VectorDocument[]) {},
    async query(): Promise<VectorQueryResult> { return emptyResult(); },
    async queryById(): Promise<VectorQueryResult> { return emptyResult(); },
    async getStats() { return { count: 0 }; },
    async getCollectionInfo() { return { count: 0, name: 'memory' }; },
  };
}

function guarded(registryPath: string, modelName: string, dimension: number, extras = {}) {
  return withEmbedderIdentityGuard(memoryAdapter(), {
    adapterName: 'lancedb',
    collectionName: 'oracle_knowledge',
    storagePath: '/vectors/lancedb',
    registryPath,
    embedder: { name: 'ollama', dimensions: dimension },
    modelName,
    ...extras,
  });
}

function registryEntries(registryPath: string) {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { collections: Record<string, unknown> };
  return Object.values(registry.collections);
}

function emptyResult(): VectorQueryResult {
  return { ids: [], documents: [], distances: [], metadatas: [] };
}

test('embedder identity guard persists model and dimension on connect', async () => {
  const registryPath = join(tempDir(), 'identity.json');

  await guarded(registryPath, 'bge-m3', 1024).connect();

  expect(registryEntries(registryPath)).toEqual([
    expect.objectContaining({
      adapter: 'lancedb',
      collection: 'oracle_knowledge',
      model_name: 'bge-m3',
      dimension: 1024,
    }),
  ]);
});

test('embedder identity guard refuses a collection model or dimension mismatch', async () => {
  const registryPath = join(tempDir(), 'identity.json');
  await guarded(registryPath, 'bge-m3', 1024).connect();

  await expect(guarded(registryPath, 'nomic-embed-text', 768).connect())
    .rejects.toThrow("Vector collection 'oracle_knowledge' embedder mismatch");
});

test('embedder identity guard can warn without overwriting the persisted identity', async () => {
  const registryPath = join(tempDir(), 'identity.json');
  const warnings: string[] = [];
  await guarded(registryPath, 'bge-m3', 1024).connect();

  await guarded(registryPath, 'nomic-embed-text', 768, {
    policy: 'warn',
    logger: { warn: (message: string) => warnings.push(message) },
  }).connect();

  expect(warnings[0]).toContain('embedder mismatch');
  expect(registryEntries(registryPath)[0]).toEqual(expect.objectContaining({ model_name: 'bge-m3', dimension: 1024 }));
});

test('embedder identity guard clears metadata when the collection is deleted', async () => {
  const registryPath = join(tempDir(), 'identity.json');
  const adapter = guarded(registryPath, 'bge-m3', 1024);
  await adapter.connect();
  await adapter.deleteCollection();

  expect((adapter as ReturnType<typeof memoryAdapter>).deleted).toBe(true);
  expect(registryEntries(registryPath)).toEqual([]);
});
