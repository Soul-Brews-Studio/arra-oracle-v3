import { describe, expect, test } from 'bun:test';
import { rebuildVectorCollection } from '../../routes/vector/indexer.ts';
import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';

const docs: VectorDocument[] = [
  { id: 'a', document: 'alpha', metadata: { type: 'note' } },
  { id: 'b', document: 'beta', metadata: { type: 'note' } },
  { id: 'c', document: 'gamma', metadata: { type: 'note' } },
];

function emptyQuery(): VectorQueryResult {
  return { ids: [], documents: [], distances: [], metadatas: [] };
}

function baseStore(calls: string[]): VectorStoreAdapter {
  return {
    name: 'fake',
    async connect() { calls.push('connect'); },
    async close() { calls.push('close'); },
    async ensureCollection() { calls.push('ensureCollection'); },
    async deleteCollection() { calls.push('deleteCollection'); },
    async addDocuments(batch) { calls.push(`addDocuments:${batch.map(doc => doc.id).join(',')}`); },
    async query() { return emptyQuery(); },
    async queryById() { return emptyQuery(); },
    async getStats() { return { count: 0 }; },
    async getCollectionInfo() { return { count: 0, name: 'fake' }; },
  };
}

describe('rebuildVectorCollection', () => {
  test('uses replaceDocuments when adapter supports in-place replacement', async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const store = {
      ...baseStore(calls),
      async replaceDocuments(nextDocs: VectorDocument[]) {
        calls.push(`replaceDocuments:${nextDocs.map(doc => doc.id).join(',')}`);
      },
    } satisfies VectorStoreAdapter;

    const result = await rebuildVectorCollection(store, docs, 2, current => progress.push(current));

    expect(result).toEqual({ strategy: 'replace' });
    expect(calls).toEqual(['connect', 'replaceDocuments:a,b,c']);
    expect(progress).toEqual([3]);
  });

  test('falls back to delete plus batched add when replaceDocuments is unavailable', async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const store = baseStore(calls);

    const result = await rebuildVectorCollection(store, docs, 2, current => progress.push(current));

    expect(result).toEqual({ strategy: 'delete-add' });
    expect(calls).toEqual([
      'connect',
      'deleteCollection',
      'ensureCollection',
      'addDocuments:a,b',
      'addDocuments:c',
    ]);
    expect(progress).toEqual([2, 3]);
  });
});
