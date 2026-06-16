import { Elysia } from 'elysia';
import { RecallMemoryQuery, SaveMemoryBody, SemanticMemoryQuery } from './model.ts';
import { createMemoryFanoutEndpoint } from './fanout.ts';
import { memoryStore, type MemoryInput, type MemoryRecord, type MemoryStore } from './store.ts';
import { memoryVectorIndex, type MemoryVectorHit, type MemoryVectorIndex } from './vector.ts';

export function createMemoryRoutes(
  store: MemoryStore = memoryStore,
  vectorIndex: MemoryVectorIndex = memoryVectorIndex,
) {
  return new Elysia({ prefix: '/api' })
    .post('/memory/save', async ({ body, set }) => {
      try {
        const memory = store.save(body as MemoryInput);
        const vector = await vectorIndex.index(memory);
        return { success: true, memory, vector };
      } catch (error) {
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : 'failed to save memory' };
      }
    }, {
      body: SaveMemoryBody,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Save a persisted memory' },
    })
    .use(createMemoryFanoutEndpoint())
    .get('/memory/recall', ({ query }) => {
      const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '10')));
      const items = store.recall(query.q ?? '', limit);
      return { query: query.q ?? '', total: items.length, items };
    }, {
      query: RecallMemoryQuery,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Recall persisted memories by keyword' },
    })
    .get('/memory/search', async ({ query, set }) => {
      if (!query.q?.trim()) {
        set.status = 400;
        return { success: false, error: 'Missing query parameter: q', results: [] };
      }
      const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '10')));
      try {
        const hits = await vectorIndex.search(query.q, limit);
        const records = store.getByIds(hits.map((hit) => hit.memoryId));
        return { success: true, query: query.q, total: hits.length, results: mergeHits(hits, records) };
      } catch (error) {
        set.status = 503;
        return { success: false, error: error instanceof Error ? error.message : 'memory vector search failed', results: [] };
      }
    }, {
      query: SemanticMemoryQuery,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Search memories by vector similarity' },
    });
}

function mergeHits(hits: MemoryVectorHit[], records: MemoryRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return hits.map((hit) => ({
    ...(byId.get(hit.memoryId) ?? { id: hit.memoryId, content: hit.document }),
    score: hit.score,
    distance: hit.distance,
    vectorId: hit.vectorId,
  }));
}

export const memoryRoutes = createMemoryRoutes();
