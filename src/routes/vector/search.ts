import type { Database } from 'bun:sqlite';
import { Elysia, t } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import type { SearchResult } from '../../server/types.ts';
import { filterResultsAsOf, parseAsOf } from '../../search/bitemporal.ts';
import { attachSupersedeStatus, supersedeWarnings } from '../../search/supersede-status.ts';
import { getEmbeddingModels, getVectorStoreByModel } from '../../vector/factory.ts';
import { cosineDistanceToSimilarity } from '../../vector/scoring.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';
import { asOfResponse } from '../search/asof.ts';
import { applyVectorEntityBoost } from './entity-boost.ts';

type SortField = 'score' | 'distance' | 'date' | 'id' | 'type' | 'source_file';
type SortOrder = 'asc' | 'desc';
type SearchStore = Pick<VectorStoreAdapter, 'connect' | 'ensureCollection' | 'query'> & Partial<Pick<VectorStoreAdapter, 'close'>>;
type BoostResults = (db: Database, hits: SearchHit[], query: string, tenantId?: string) => SearchHit[];
interface VectorSearchDeps {
  getStore?: (collection?: string) => SearchStore;
  getModels?: () => Record<string, unknown>;
  asOfDb?: Database;
  boostResults?: BoostResults;
}
type SearchHit = SearchResult & { metadata: Record<string, unknown> };

const DEFAULT_COLLECTION = 'bge-m3', MAX_LIMIT = 100, MAX_FETCH = 1_000;
const dateKeys = ['created_at', 'createdAt', 'updated_at', 'updatedAt', 'indexed_at', 'indexedAt', 'date'];
const sortFields = new Set<SortField>(['score', 'distance', 'date', 'id', 'type', 'source_file']);
const stringQuery = t.Optional(t.String());
const VectorSearchQuery = t.Object({
  q: stringQuery, type: stringQuery, collection: stringQuery, model: stringQuery, limit: stringQuery, offset: stringQuery,
  from: stringQuery, to: stringQuery, dateFrom: stringQuery, dateTo: stringQuery, metadata: stringQuery, sort: stringQuery,
  order: stringQuery, asOf: stringQuery,
});

function sanitize(query: string): string { return query.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim(); }
function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Math.min(max, Number.isFinite(parsed) && parsed > 0 ? parsed : fallback);
}
function offsetOf(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
function metadataFilters(request: Request, type?: string): Record<string, unknown> {
  const params = new URL(request.url).searchParams, filters: Record<string, unknown> = {};
  const raw = params.get('metadata') ?? params.get('meta');
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('metadata must be a JSON object');
    Object.assign(filters, parsed);
  }
  for (const [key, value] of params.entries()) {
    if (key.startsWith('metadata.')) filters[key.slice(9)] = scalar(value);
    if (key.startsWith('meta.')) filters[key.slice(5)] = scalar(value);
  }
  if (type && type !== 'all') filters.type = type;
  return filters;
}
function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : value == null ? fallback : String(value); }
function concepts(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => text(item)).filter(Boolean);
  } catch { return value.split(',').map((item) => item.trim()).filter(Boolean); }
  return [];
}
function toHits(result: VectorQueryResult, collection: string): SearchHit[] {
  return result.ids.map((id, index) => {
    const metadata = normalizeMetadata(result.metadatas?.[index]), distance = Number(result.distances?.[index] ?? 0);
    return {
      id, type: text(metadata.type, 'unknown'), content: text(result.documents?.[index]),
      source_file: text(metadata.source_file ?? metadata.sourceFile), concepts: concepts(metadata.concepts), source: 'vector',
      score: cosineDistanceToSimilarity(distance), distance, model: collection, metadata,
    };
  });
}
function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual == null) return false;
  if (typeof actual === 'object' || typeof expected === 'object') return JSON.stringify(actual) === JSON.stringify(expected);
  return String(actual) === String(expected);
}
function matchesMetadata(hit: SearchHit, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => key === 'type' ? sameValue(hit.type, value) : sameValue(hit.metadata[key], value));
}
function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function hitDate(hit: SearchHit): number | undefined {
  for (const key of dateKeys) {
    const value = timestamp(hit.metadata[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}
function withinDateRange(hit: SearchHit, from?: number, to?: number): boolean {
  if (from === undefined && to === undefined) return true;
  const value = hitDate(hit);
  return value !== undefined && (from === undefined || value >= from) && (to === undefined || value <= to);
}
function sortConfig(raw: string | undefined, rawOrder: string | undefined): { field: SortField; order: SortOrder } {
  const fieldName = raw?.startsWith('-') ? raw.slice(1) : raw;
  const field = sortFields.has(fieldName as SortField) ? fieldName as SortField : 'score';
  const order = raw?.startsWith('-') ? 'desc'
    : rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder
    : field === 'distance' || field === 'id' || field === 'type' || field === 'source_file' ? 'asc' : 'desc';
  return { field, order };
}
function sortValue(hit: SearchHit, field: SortField): string | number {
  if (field === 'distance') return hit.distance ?? Number.POSITIVE_INFINITY;
  if (field === 'date') return hitDate(hit) ?? 0;
  if (field === 'id') return hit.id;
  if (field === 'type') return hit.type;
  if (field === 'source_file') return hit.source_file;
  return hit.score ?? 0;
}
function sortHits(hits: SearchHit[], field: SortField, order: SortOrder): SearchHit[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...hits].sort((left, right) => {
    const a = sortValue(left, field), b = sortValue(right, field);
    const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return compared === 0 ? left.id.localeCompare(right.id) : compared * direction;
  });
}
function resolveCollection(collection: string | undefined, getModels: () => Record<string, unknown>): string | null {
  const name = (collection || DEFAULT_COLLECTION).trim(), models = getModels();
  if (name in models) return name;
  const found = Object.values(models).find((m) => typeof m === 'object' && m && 'collection' in m && (m as { collection: string }).collection === name);
  return found ? name : null;
}
function filterAsOf(hits: SearchHit[], db: Database, asOfMs?: number): SearchHit[] {
  return filterResultsAsOf(db, hits as unknown as Array<Record<string, unknown>>, asOfMs) as unknown as SearchHit[];
}

export function createVectorSearchEndpoint(deps: VectorSearchDeps = {}) {
  const getModels = deps.getModels ?? getEmbeddingModels, getStore = deps.getStore ?? getVectorStoreByModel, asOfDb = deps.asOfDb ?? sqlite;
  const boostResults = deps.boostResults ?? ((db, hits, query, tenantId) => applyVectorEntityBoost(db, hits, query, { tenantId }));
  return new Elysia().get('/vector/search', async ({ query, request, set }) => {
    if (!query.q) { set.status = 400; return { error: 'Missing query parameter: q' }; }
    const q = sanitize(query.q);
    if (!q) { set.status = 400; return { error: 'Invalid query: empty after sanitization' }; }
    const asOf = parseAsOf(query.asOf);
    if (!asOf.ok) { set.status = 400; return { error: asOf.error }; }
    const collection = resolveCollection(query.collection ?? query.model, getModels);
    if (!collection) { set.status = 404; return { error: `Unknown vector collection: ${query.collection ?? query.model}` }; }

    let metadata: Record<string, unknown>;
    try {
      const tenantId = currentTenantId();
      metadata = metadataFilters(request, query.type);
      if (tenantId) metadata.tenant_id = tenantId;
    } catch (error) {
      set.status = 400;
      return { error: 'Invalid metadata filter', message: error instanceof Error ? error.message : String(error) };
    }

    const limit = positiveInt(query.limit, 10, MAX_LIMIT), offset = offsetOf(query.offset);
    const from = timestamp(query.from ?? query.dateFrom), to = timestamp(query.to ?? query.dateTo);
    const sort = sortConfig(query.sort, query.order), fetchLimit = Math.min(MAX_FETCH, Math.max(offset + limit, limit * 5));
    let store: SearchStore | undefined;
    try {
      store = getStore(collection);
      await store.connect();
      await store.ensureCollection();
      const raw = await store.query(q, fetchLimit, Object.keys(metadata).length > 0 ? metadata : undefined);
      const filtered = filterAsOf(toHits(raw, collection), asOfDb, asOf.value)
        .filter((hit) => matchesMetadata(hit, metadata))
        .filter((hit) => withinDateRange(hit, from, to));
      const boosted = boostResults(asOfDb, filtered, q, currentTenantId());
      const sorted = sortHits(boosted, sort.field, sort.order);
      const results = sorted.slice(offset, offset + limit);
      attachSupersedeStatus(asOfDb, results as unknown as Array<Record<string, unknown>>);
      const warnings = supersedeWarnings(results as unknown as Array<Record<string, unknown>>);
      return {
        results, total: sorted.length, offset, limit, query: q, mode: 'vector', collection,
        filters: { metadata, dateRange: { from: query.from ?? query.dateFrom, to: query.to ?? query.dateTo }, asOf: query.asOf },
        sort, vectorAvailable: true, ...(warnings.length ? { warnings } : {}), ...asOfResponse(asOf.value),
      };
    } catch (error) {
      set.status = 400;
      const message = error instanceof Error ? error.message : String(error);
      return { results: [], total: 0, query: q, error: 'Vector search failed', message };
    } finally { await store?.close?.().catch(() => undefined); }
  }, {
    query: VectorSearchQuery,
    detail: { tags: ['vector'], menu: { group: 'hidden' }, summary: 'Vector search with filters, pagination, sort, and asOf valid-time filtering' },
  });
}

export const vectorSearchEndpoint = createVectorSearchEndpoint();
