import { expect, test } from 'bun:test';
import type {
  VectorDocument,
  VectorQueryResult,
  VectorStoreAdapter,
} from '../../src/vector/adapter.ts';
import type { VectorStoreAdapter as FactoryVectorStoreAdapter } from '../../src/vector/factory.ts';
import type { VectorStoreAdapter as LegacyVectorStoreAdapter } from '../../src/vector/types.ts';

function createMemoryAdapter() {
  const docs: VectorDocument[] = [];
  return {
    name: 'memory',
    async connect() {},
    async close() {},
    async ensureCollection() {},
    async deleteCollection() {
      docs.length = 0;
    },
    async addDocuments(next: VectorDocument[]) {
      docs.push(...next);
    },
    async query(): Promise<VectorQueryResult> {
      return {
        ids: docs.map((doc) => doc.id),
        documents: docs.map((doc) => doc.document),
        distances: docs.map(() => 0),
        metadatas: docs.map((doc) => doc.metadata),
      };
    },
    async queryById(id: string): Promise<VectorQueryResult> {
      const found = docs.filter((doc) => doc.id === id);
      return {
        ids: found.map((doc) => doc.id),
        documents: found.map((doc) => doc.document),
        distances: found.map(() => 0),
        metadatas: found.map((doc) => doc.metadata),
      };
    },
    async getStats() {
      return { count: docs.length };
    },
    async getCollectionInfo() {
      return { count: docs.length, name: 'memory' };
    },
  } satisfies VectorStoreAdapter;
}

test('extracted vector adapter contract remains re-export compatible', async () => {
  const adapter = createMemoryAdapter();
  const legacy: LegacyVectorStoreAdapter = adapter;
  const factoryExport: FactoryVectorStoreAdapter = adapter;

  await legacy.addDocuments([{ id: 'doc-1', document: 'hello', metadata: { tenant: 'acme' } }]);

  expect(factoryExport.name).toBe('memory');
  expect(await adapter.getStats()).toEqual({ count: 1 });
  expect((await legacy.queryById('doc-1')).documents).toEqual(['hello']);
});
