import { Elysia } from 'elysia';
import { MorningTapeQuery, RecallMemoryQuery, SaveMemoryBody, SemanticMemoryQuery } from './model.ts';
import { createMemoryFanoutEndpoint } from './fanout.ts';
import { memoryStore, type MemoryInput, type MemoryRecord, type MemoryStore } from './store.ts';
import { memoryVectorIndex, type MemoryVectorHit, type MemoryVectorIndex } from './vector.ts';
import { buildMorningTape } from './morning-tape.ts';
import { MEMORY_CONFIDENCE_STRATEGY, memoryConfidence } from './confidence.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

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
    .get('/memory/morning-tape', ({ query }) => {
      const limit = Math.min(25, Math.max(1, parseInt(query.limit ?? '8')));
      const tape = buildMorningTape(store.recall('', limit));
      if (query.format === 'markdown' || query.format === 'md') {
        return new Response(tape.markdown, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
      }
      return tape;
    }, {
      query: MorningTapeQuery,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Render a two-minute morning recovery tape from persisted memories' },
    })
    .get('/memory/recall', ({ query }) => {
      const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '10')));
      const items = store.recall(query.q ?? '', limit);
      return { query: query.q ?? '', total: items.length, confidence: MEMORY_CONFIDENCE_STRATEGY, items: items.map(withKeywordConfidence) };
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
        return { success: true, query: query.q, total: hits.length, confidence: MEMORY_CONFIDENCE_STRATEGY, results: mergeHits(hits, records) };
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
  const tenantId = currentTenantId();
  return hits.flatMap((hit) => {
    const record = byId.get(hit.memoryId);
    if (tenantId && !record) return [];
    const hitTenantId = hitTenant(hit);
    if (tenantId && hitTenantId && hitTenantId !== tenantId) return [];
    const memory = memoryForHit(hit, record);
    return [{
      ...memory,
      score: hit.score,
      distance: hit.distance,
      vectorId: hit.vectorId,
      confidence: memoryConfidence(memory, { mode: 'semantic', semanticScore: hit.score }),
    }];
  });
}

function hitTenant(hit: MemoryVectorHit): string | undefined {
  const value = hit.metadata.tenant_id ?? hit.metadata.tenantId ?? hit.metadata.tenant;
  return typeof value === 'string' ? value : undefined;
}

function withKeywordConfidence(memory: MemoryRecord) {
  return { ...memory, confidence: memoryConfidence(memory, { mode: 'keyword' }) };
}

function memoryForHit(hit: MemoryVectorHit, record?: MemoryRecord): MemoryRecord {
  if (record) return record;
  const createdAt = typeof hit.metadata.createdAt === 'string' ? hit.metadata.createdAt : new Date().toISOString();
  return {
    id: hit.memoryId,
    content: hit.document,
    tags: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export const memoryRoutes = createMemoryRoutes();
