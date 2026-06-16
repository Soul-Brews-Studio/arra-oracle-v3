import { describe, expect, test } from 'bun:test';
import { QdrantAdapter } from '../adapters/qdrant.ts';
import type { EmbeddingProvider } from '../types.ts';

const embedder: EmbeddingProvider = {
  name: 'unit-embedder',
  dimensions: 3,
  model: 'unit-model',
  async embed(texts: string[]) {
    return texts.map((text) => text === 'query' ? [0.1, 0.2, 0.3] : [0.3, 0.2, 0.1]);
  },
};

describe('QdrantAdapter unit behavior without network', () => {
  test('not-connected guards are explicit and stats default to zero', async () => {
    const adapter = new QdrantAdapter('unit_collection', embedder);

    await expect(adapter.ensureCollection()).rejects.toThrow('Qdrant not connected');
    await expect(adapter.deleteCollection()).rejects.toThrow('Qdrant not connected');
    await expect(adapter.addDocuments([{ id: 'a', document: 'doc', metadata: {} }])).rejects.toThrow('Qdrant not connected');
    await expect(adapter.query('query')).rejects.toThrow('Qdrant not connected');
    await expect(adapter.queryById('a')).rejects.toThrow('Qdrant not connected');
    expect(await adapter.getStats()).toEqual({ count: 0 });
    expect(await adapter.getCollectionInfo()).toEqual({ name: 'unit_collection', count: 0 });
  });

  test('ensureCollection creates missing collection with embedder dimensions', async () => {
    const adapter = new QdrantAdapter('unit_collection', embedder) as any;
    const calls: any[] = [];
    adapter.client = {
      async getCollection() { throw new Error('missing'); },
      async createCollection(name: string, config: unknown) { calls.push({ name, config }); },
    };

    await adapter.ensureCollection();

    expect(calls).toEqual([{
      name: 'unit_collection',
      config: { vectors: { size: 3, distance: 'Cosine' } },
    }]);
  });

  test('addDocuments embeds passages and upserts payload documents', async () => {
    const adapter = new QdrantAdapter('unit_collection', embedder) as any;
    let upsertPayload: any;
    adapter.client = {
      async upsert(collection: string, payload: unknown) { upsertPayload = { collection, payload }; },
    };

    await adapter.addDocuments([
      { id: 'doc-a', document: 'alpha', metadata: { type: 'learning' } },
      { id: 'doc-b', document: 'beta', metadata: { source_file: 'b.md' } },
    ]);

    expect(upsertPayload.collection).toBe('unit_collection');
    expect(upsertPayload.payload.points).toHaveLength(2);
    expect(upsertPayload.payload.points[0].payload).toMatchObject({ _id: 'doc-a', document: 'alpha', type: 'learning' });
    expect(upsertPayload.payload.points[0].vector).toEqual([0.3, 0.2, 0.1]);
  });

  test('query maps Qdrant similarity scores to distances and metadata', async () => {
    const adapter = new QdrantAdapter('unit_collection', embedder) as any;
    let searchRequest: any;
    adapter.client = {
      async search(collection: string, request: unknown) {
        searchRequest = { collection, request };
        return [
          { id: 1, score: 0.8, payload: { _id: 'doc-a', document: 'alpha', type: 'learning' } },
          { id: 2, score: 0.5, payload: { document: 'fallback id', type: 'pattern' } },
        ];
      },
    };

    const result = await adapter.query('query', 2, { type: 'learning' });

    expect(searchRequest.collection).toBe('unit_collection');
    expect(searchRequest.request).toMatchObject({
      vector: [0.1, 0.2, 0.3],
      limit: 2,
      with_payload: true,
      filter: { must: [{ key: 'type', match: { value: 'learning' } }] },
    });
    expect(result.ids).toEqual(['doc-a', '2']);
    expect(result.documents).toEqual(['alpha', 'fallback id']);
    expect(result.distances).toEqual([0.19999999999999996, 0.5]);
    expect(result.metadatas).toEqual([{ type: 'learning' }, { type: 'pattern' }]);
  });

  test('queryById retrieves source vector and filters self from neighbors', async () => {
    const adapter = new QdrantAdapter('unit_collection', embedder) as any;
    adapter.client = {
      async retrieve(_collection: string, request: any) {
        expect(request.with_vector).toBe(true);
        return [{ id: request.ids[0], vector: [0.4, 0.5, 0.6] }];
      },
      async search(_collection: string, request: any) {
        expect(request.limit).toBe(3);
        return [
          { id: 11, score: 1, payload: { _id: 'doc-a', document: 'self' } },
          { id: 12, score: 0.7, payload: { _id: 'doc-b', document: 'neighbor', source_file: 'b.md' } },
          { id: 13, score: 0.6, payload: { _id: 'doc-c', document: 'neighbor c' } },
        ];
      },
    };

    const result = await adapter.queryById('doc-a', 2);

    expect(result.ids).toEqual(['doc-b', 'doc-c']);
    expect(result.documents).toEqual(['neighbor', 'neighbor c']);
    expect(result.distances).toEqual([0.30000000000000004, 0.4]);
    expect(result.metadatas[0]).toEqual({ source_file: 'b.md' });
  });
});

import { SqliteVecAdapter } from '../adapters/sqlite-vec.ts';

describe('SqliteVecAdapter unit behavior without sqlite-vec extension', () => {
  test('not-connected guards and empty-result helpers are stable', async () => {
    const adapter = new SqliteVecAdapter('unit_sqlite', '/tmp/unit-sqlite.db', embedder);

    await expect(adapter.ensureCollection()).rejects.toThrow('sqlite-vec not connected');
    await expect(adapter.deleteCollection()).rejects.toThrow('sqlite-vec not connected');
    await expect(adapter.query('query')).rejects.toThrow('sqlite-vec not connected');
    await expect(adapter.queryById('doc-a')).rejects.toThrow('sqlite-vec not connected');
    await adapter.addDocuments([]);
    expect(await adapter.getStats()).toEqual({ count: 0 });
    expect(await adapter.getCollectionInfo()).toEqual({ name: 'unit_sqlite', count: 0 });
    expect(await adapter.getAllEmbeddings()).toEqual({ ids: [], embeddings: [], metadatas: [] });
  });
});
