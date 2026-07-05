import { Elysia } from 'elysia';
import { MemoryCloseoutBody, MemoryTiersQuery, MorningTapeQuery, RecallMemoryQuery, SaveMemoryBody, SemanticMemoryQuery, parseMemoryLimit } from './model.ts';
import { createMemoryFanoutEndpoint } from './fanout.ts';
import { memoryStore, parseValidTime, type MemoryInput, type MemoryRecord, type MemoryStore } from './store.ts';
import { memoryVectorIndex, type MemoryVectorHit, type MemoryVectorIndex } from './vector.ts';
import { buildMorningTape } from './morning-tape.ts';
import { MEMORY_CONFIDENCE_STRATEGY } from './confidence.ts';
import { formatCloseoutMemory, type MemoryCloseoutInput } from './closeout.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { rankMemories } from './rank.ts';
import { createMemoryStatsEndpoint } from './stats.ts';
import { candidatePoolSize } from '../../search/retrieve-depth.ts';

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
    .post('/memory/closeout', async ({ body, set }) => {
      try {
        const memory = store.save(formatCloseoutMemory(body as MemoryCloseoutInput));
        const vector = await vectorIndex.index(memory);
        return { success: true, memory, vector };
      } catch (error) {
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : 'failed to close out memory' };
      }
    }, {
      body: MemoryCloseoutBody,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Persist a Challenge 2 session close-out memory' },
    })
    .use(createMemoryFanoutEndpoint())
    .use(createMemoryStatsEndpoint())
    .get('/memory/morning-tape', ({ query }) => {
      const limit = parseMemoryLimit(query.limit, 8, 25);
      const tape = buildMorningTape(store.recall('', limit));
      if (query.format === 'markdown' || query.format === 'md') {
        return new Response(tape.markdown, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
      }
      return tape;
    }, {
      query: MorningTapeQuery,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Render a two-minute morning recovery tape from persisted memories' },
    })
    .get('/memory/recall', ({ query, set }) => {
      const limit = parseMemoryLimit(query.limit);
      const includeCold = query.includeCold === undefined ? undefined : query.includeCold === 'true' || query.includeCold === '1';
      try {
        const candidates = store.recall(query.q ?? '', limit, { asOf: query.asOf, includeCold });
        const items = rankMemories(candidates, { mode: 'keyword', asOf: query.asOf });
        return { query: query.q ?? '', asOf: isoAsOf(query.asOf), total: items.length, confidence: MEMORY_CONFIDENCE_STRATEGY, items };
      } catch (error) {
        return invalidAsOf(set, error);
      }
    }, {
      query: RecallMemoryQuery,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Recall persisted memories by keyword' },
    })
    .get('/memory/tiers', ({ query }) => ({
      strategy: 'heat-based-tiered-salience',
      tiers: ['core', 'warm', 'cold'],
      eviction: 'cold memories are preserved and excluded from ambient recall unless requested',
      ...store.tierSummary(parseMemoryLimit(query.limit, 5, 25)),
    }), {
      query: MemoryTiersQuery,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Summarize core/warm/cold memory tiers' },
    })
    .get('/memory/search', async ({ query, set }) => {
      if (!query.q?.trim()) {
        set.status = 400;
        return { success: false, error: 'Missing query parameter: q', results: [] };
      }
      const limit = parseMemoryLimit(query.limit);
      try {
        isoAsOf(query.asOf);
        const candidateLimit = candidatePoolSize(limit);
        const hits = await vectorIndex.search(query.q, candidateLimit);
        const records = store.getByIds(hits.map((hit) => hit.memoryId), { asOf: query.asOf });
        const merged = mergeHits(hits, records);
        const scores = new Map(hits.map((hit) => [hit.memoryId, hit.score]));
        const entityScores = new Map(hits.map((hit) => [hit.memoryId, entityScoreFromHit(hit)]));
        const results = rankMemories(merged, {
          mode: 'semantic',
          asOf: query.asOf,
          score: (memory) => scores.get(memory.id),
          entityScore: (memory) => entityScores.get(memory.id),
        }).slice(0, limit);
        return {
          success: true, query: query.q, asOf: isoAsOf(query.asOf), total: results.length,
          confidence: MEMORY_CONFIDENCE_STRATEGY,
          ranking: { strategy: 'valid_time_confidence_heat_entity_match', candidatePool: candidateLimit },
          results,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'memory vector search failed';
        set.status = message.includes('valid-time') ? 400 : 503;
        return { success: false, error: message, results: [] };
      }
    }, {
      query: SemanticMemoryQuery,
      detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Search memories by vector similarity' },
    });
}

function isoAsOf(value: string | undefined): string | undefined {
  return value ? new Date(parseValidTime(value)!).toISOString() : undefined;
}

function invalidAsOf(set: { status?: number | string }, error: unknown) {
  set.status = 400;
  return { success: false, error: error instanceof Error ? error.message : 'invalid valid-time timestamp' };
}

function mergeHits(hits: MemoryVectorHit[], records: MemoryRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const tenantId = currentTenantId();
  const seen = new Set<string>();
  return hits.flatMap((hit) => {
    if (seen.has(hit.memoryId)) return [];
    const record = byId.get(hit.memoryId);
    if (tenantId && !record) return [];
    const hitTenantId = hitTenant(hit);
    if (tenantId && hitTenantId && hitTenantId !== tenantId) return [];
    const memory = memoryForHit(hit, record);
    seen.add(hit.memoryId);
    return [{ ...memory, score: hit.score, distance: hit.distance, vectorId: hit.vectorId }];
  });
}

function hitTenant(hit: MemoryVectorHit): string | undefined {
  const value = hit.metadata.tenant_id ?? hit.metadata.tenantId ?? hit.metadata.tenant;
  return typeof value === 'string' ? value : undefined;
}

function entityScoreFromHit(hit: MemoryVectorHit): number | undefined {
  const value = hit.metadata.entityScore
    ?? hit.metadata.entity_score
    ?? hit.metadata.entityMatchScore
    ?? hit.metadata.entity_match_score;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : undefined;
}

function memoryForHit(hit: MemoryVectorHit, record?: MemoryRecord): MemoryRecord {
  if (record) return record;
  const createdAt = metadataText(hit.metadata.createdAt) ?? new Date().toISOString();
  return {
    id: hit.memoryId,
    content: hit.document,
    title: metadataText(hit.metadata.title),
    tags: metadataList(hit.metadata.tags ?? hit.metadata.concepts),
    source: metadataText(hit.metadata.source ?? hit.metadata.source_file),
    createdAt,
    updatedAt: metadataText(hit.metadata.updatedAt) ?? createdAt,
    tier: metadataTier(hit.metadata.tier),
    heatScore: metadataNumber(hit.metadata.heatScore ?? hit.metadata.heat_score) ?? 0,
    usageCount: metadataNumber(hit.metadata.usageCount ?? hit.metadata.usage_count) ?? 0,
    lastAccessedAt: metadataText(hit.metadata.lastAccessedAt ?? hit.metadata.last_accessed_at),
    validFrom: metadataText(hit.metadata.validFrom ?? hit.metadata.valid_from),
    validTo: metadataText(hit.metadata.validTo ?? hit.metadata.valid_to),
  };
}

function metadataText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataTier(value: unknown): MemoryRecord['tier'] {
  return value === 'core' || value === 'cold' ? value : 'warm';
}

function metadataNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metadataList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return metadataList(parsed);
  } catch {}
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export const memoryRoutes = createMemoryRoutes();
