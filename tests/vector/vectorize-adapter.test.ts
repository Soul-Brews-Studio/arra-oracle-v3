import { describe, expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';
import { VectorizeAdapter } from '../../src/vector/adapters/cloudflare.ts';
import type { EmbeddingProvider, EmbedType } from '../../src/vector/types.ts';
import type { CloudflareVectorizeBinding } from '../../src/vector/adapters/cloudflare.ts';

type Vector = { id: string; values: number[]; namespace?: string; metadata?: Record<string, unknown> };

class StubEmbedder implements EmbeddingProvider {
  readonly name = 'stub';
  readonly dimensions = 3;
  calls: Array<{ texts: string[]; type?: EmbedType }> = [];
  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    this.calls.push({ texts, type });
    return texts.map((_, index) => [1, index + 1, 0]);
  }
}

function mockVectorize(): CloudflareVectorizeBinding & {
  records: Map<string, Vector>;
  queries: Record<string, unknown>[];
  describe: () => Promise<{ vectorsCount: number }>;
  listVectors: (options?: { namespace?: string }) => Promise<{ ids: string[] }>;
} {
  const records = new Map<string, Vector>();
  const queries: Record<string, unknown>[] = [];
  return {
    records,
    queries,
    upsert: async (vectors) => { for (const vector of vectors as Vector[]) records.set(vector.id, vector); },
    query: async (_vector, options = {}) => {
      queries.push(options);
      return { matches: [...records.values()].map((vector) => ({ id: vector.id, score: 0.75, metadata: vector.metadata })) };
    },
    queryById: async (_id, options = {}) => {
      queries.push(options);
      return { matches: [...records.values()].map((vector) => ({ id: vector.id, score: 0.75, metadata: vector.metadata })) };
    },
    getByIds: async (ids) => ids.map((id) => records.get(id)).filter(Boolean),
    deleteByIds: async (ids) => { for (const id of ids) records.delete(id); },
    describe: async () => ({ vectorsCount: records.size }),
    listVectors: async (options = {}) => ({
      ids: [...records.values()].filter((vector) => !options.namespace || vector.namespace === options.namespace).map((vector) => vector.id),
    }),
  };
}

describe('VectorizeAdapter', () => {
  test('upserts precomputed vectors and queries with namespace plus metadata filters', async () => {
    const embedder = new StubEmbedder();
    const vectorize = mockVectorize();
    const adapter = new VectorizeAdapter('edge_docs', embedder, vectorize);

    await adapter.addDocuments([{ id: 'doc-1', document: 'hello edge', metadata: { kind: 'note' }, vector: [1, 2, 3] }]);
    const result = await adapter.query('hello', Number.NaN, { kind: 'note' });

    expect(embedder.calls).toEqual([{ texts: ['hello'], type: 'query' }]);
    expect(vectorize.records.get('doc-1')).toMatchObject({
      namespace: 'edge_docs',
      metadata: { kind: 'note', collection: 'edge_docs', document: 'hello edge' },
    });
    expect(vectorize.queries[0]).toMatchObject({
      topK: 10,
      namespace: 'edge_docs',
      returnMetadata: 'all',
      filter: { kind: { $eq: 'note' } },
    });
    expect(result).toEqual({
      ids: ['doc-1'],
      documents: ['hello edge'],
      distances: [0.25],
      metadatas: [{ kind: 'note', collection: 'edge_docs' }],
    });
  });

  test('queryById falls back through Vectorize and excludes the source id', async () => {
    const vectorize = mockVectorize();
    delete (vectorize as Partial<typeof vectorize>).queryById;
    const adapter = new VectorizeAdapter('edge_docs', new StubEmbedder(), vectorize);
    await adapter.addDocuments([
      { id: 'doc-1', document: 'source', metadata: {}, vector: [1, 0, 0] },
      { id: 'doc-2', document: 'neighbor', metadata: {}, vector: [0, 1, 0] },
    ]);

    const result = await adapter.queryById('doc-1', 5);

    expect(result.ids).toEqual(['doc-2']);
    expect(result.documents).toEqual(['neighbor']);
  });

  test('deletes all vectors in the adapter namespace', async () => {
    const vectorize = mockVectorize();
    const adapter = new VectorizeAdapter('edge_docs', new StubEmbedder(), vectorize);
    await adapter.addDocuments([{ id: 'doc-1', document: 'delete me', metadata: {}, vector: [1, 0, 0] }]);

    await adapter.deleteCollection();

    expect(await adapter.getStats()).toEqual({ count: 0 });
  });

  test('factory selects binding-only Vectorize without REST credentials', () => {
    const store = createVectorStore({
      type: 'cloudflare-vectorize',
      collectionName: 'edge_docs',
      cfAi: { run: async (_model, input) => ({ data: input.text.map(() => [1, 0, 0]) }) },
      cfVectorize: mockVectorize(),
    });

    expect(store).toBeInstanceOf(VectorizeAdapter);
  });
});
