import { describe, expect, test } from 'bun:test';
import { applyVectorIndexPlanAhead } from '../../src/indexer/vector-index-ahead.ts';
import type { VectorIndexPlan } from '../../src/indexer/vector-index-manifest.ts';
import type { EmbeddingProvider, VectorDocument, VectorStoreAdapter } from '../../src/vector/types.ts';

const doc = (id: string, document: string): VectorDocument => ({ id, document, metadata: {} });
const embedder: EmbeddingProvider = { name: 'fake', dimensions: 1, embed: async (t) => t.map((x) => [x.length]) };

function fakeStore() {
  const log: string[] = [];
  const written: VectorDocument[] = [];
  const store = {
    name: 'fake',
    connect: async () => {}, close: async () => {}, ensureCollection: async () => {}, deleteCollection: async () => {},
    query: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    queryById: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    getStats: async () => ({ count: 0 }),
    addDocuments: async (docs: VectorDocument[]) => { log.push(`add ${docs.length}`); written.push(...docs); },
    replaceDocuments: async (docs: VectorDocument[]) => { log.push(`replace ${docs.length}`); written.push(...docs); },
    deleteDocuments: async (ids: string[]) => { log.push(`delete ${ids.join(',')}`); },
  } as unknown as VectorStoreAdapter;
  return { store, log, written };
}

const plan = (docs: VectorDocument[], changed: VectorDocument[], stale: string[] = []) =>
  ({ docs, changedDocs: changed, staleIds: stale, total: docs.length, skipped: docs.length - changed.length } as unknown as VectorIndexPlan);

describe('applyVectorIndexPlanAhead', () => {
  test('baseline: first write replaces, the rest append, all shortest first with vectors', async () => {
    const docs = ['ccc', 'a', 'bb', 'dddd', 'e'].map((t, i) => doc(`d${i}`, t));
    const { store, log, written } = fakeStore();
    const res = await applyVectorIndexPlanAhead(store, plan(docs, docs), embedder, { replaceBaseline: true, embedBatch: 2, writeBatch: 2 });
    expect(log).toEqual(['replace 2', 'add 2', 'add 1']);
    expect(written.map((d) => d.document)).toEqual(['a', 'e', 'bb', 'ccc', 'dddd']);
    expect(written.every((d) => Array.isArray(d.vector))).toBe(true);
    expect(res).toMatchObject({ embedded: 5, replaced: true, errors: 0, aborted: false });
  });

  test('incremental: deletes stale and changed ids, then adds only the changed', async () => {
    const docs = [doc('a', 'x'), doc('b', 'yy')];
    const { store, log } = fakeStore();
    const res = await applyVectorIndexPlanAhead(store, plan(docs, [docs[1]], ['gone']), embedder, {});
    expect(log).toEqual(['delete gone,b', 'add 1']);
    expect(res).toMatchObject({ embedded: 1, deleted: 1, replaced: false });
  });

  test('nothing changed and no baseline: no store calls', async () => {
    const { store, log } = fakeStore();
    const res = await applyVectorIndexPlanAhead(store, plan([doc('a', 'x')], []), embedder, {});
    expect(log).toEqual([]);
    expect(res.embedded).toBe(0);
  });
});
