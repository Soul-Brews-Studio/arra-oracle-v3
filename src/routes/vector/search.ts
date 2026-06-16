/** GET /api/vector/search - vector search with filters, pagination, and sort. */
import { Elysia, t } from 'elysia';
import { getEmbeddingModels, getVectorStoreByModel } from '../../vector/factory.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';
import type { SearchResult } from '../../server/types.ts';

type SortField = 'score' | 'distance' | 'date' | 'id' | 'type' | 'source_file';
type SortOrder = 'asc' | 'desc';
type SearchStore = Pick<VectorStoreAdapter, 'connect' | 'ensureCollection' | 'query'>;

interface VectorSearchDeps {
  getStore?: (collection?: string) => SearchStore;
  getModels?: () => Record<string, unknown>;
}

type SearchHit = SearchResult & { metadata: Record<string, unknown> };

const DEFAULT_COLLECTION = 'bge-m3';
const MAX_LIMIT = 100;
const MAX_FETCH = 1_000;
const dateKeys = ['created_at', 'createdAt', 'updated_at', 'updatedAt', 'indexed_at', 'indexedAt', 'date'];
const sortFields = new Set<SortField>(['score', 'distance', 'date', 'id', 'type', 'source_file']);
const stringQuery = t.Optional(t.String());
const VectorSearchQuery = t.Object({
  q: stringQuery, type: stringQuery, collection: stringQuery, model: stringQuery, limit: stringQuery, offset: stringQuery,
  from: stringQuery, to: stringQuery, dateFrom: stringQuery, dateTo: stringQuery, metadata: stringQuery, sort: stringQuery, order: stringQuery,
});

function sanitize(query: string): string {
  return query.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

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
  const params = new URL(request.url).searchParams;
  const filters: Record<string, unknown> = {};
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

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
}

function concepts(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => text(item)).filter(Boolean);
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function toHits(result: VectorQueryResult, collection: string): SearchHit[] {
  return result.ids.map((id, index) => {
    const metadata = normalizeMetadata(result.metadatas?.[index]);
    const distance = Number(result.distances?.[index] ?? 0);
    return {
      id,
      type: text(metadata.type, 'unknown'),
      content: text(result.documents?.[index]),
      source_file: text(metadata.source_file ?? metadata.sourceFile),
      concepts: concepts(metadata.concepts),
      source: 'vector',
      score: 1 / (1 + distance / 100),
      distance,
      model: collection,
      metadata,
    };
  });
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual == null) return false;
  if (typeof actual === 'object' || typeof expected === 'object') {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return String(actual) === String(expected);
}

function matchesMetadata(hit: SearchHit, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => (
    key === 'type' ? sameValue(hit.type, value) : sameValue(hit.metadata[key], value)
  ));
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
  if (value === undefined) return false;
  return (from === undefined || value >= from) && (to === undefined || value <= to);
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
    const a = sortValue(left, field);
    const b = sortValue(right, field);
    const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return compared === 0 ? left.id.localeCompare(right.id) : compared * direction;
  });
}

function resolveCollection(collection: string | undefined, getModels: () => Record<string, unknown>): string | null {
  const name = (collection || DEFAULT_COLLECTION).trim();
  return name in getModels() ? name : null;
}

export function createVectorSearchEndpoint(deps: VectorSearchDeps = {}) {
  const getModels = deps.getModels ?? getEmbeddingModels;
  const getStore = deps.getStore ?? getVectorStoreByModel;

  return new Elysia().get('/vector/search', async ({ query, request, set }) => {
    if (!query.q) {
      set.status = 400;
      return { error: 'Missing query parameter: q' };
    }
    const q = sanitize(query.q);
    if (!q) {
      set.status = 400;
      return { error: 'Invalid query: empty after sanitization' };
    }

    const collection = resolveCollection(query.collection ?? query.model, getModels);
    if (!collection) {
      set.status = 404;
      return { error: `Unknown vector collection: ${query.collection ?? query.model}` };
    }

    let metadata: Record<string, unknown>;
    try {
      metadata = metadataFilters(request, query.type);
    } catch (error) {
      set.status = 400;
      return { error: 'Invalid metadata filter', message: error instanceof Error ? error.message : String(error) };
    }

    const limit = positiveInt(query.limit, 10, MAX_LIMIT);
    const offset = offsetOf(query.offset);
    const from = timestamp(query.from ?? query.dateFrom);
    const to = timestamp(query.to ?? query.dateTo);
    const sort = sortConfig(query.sort, query.order);
    const fetchLimit = Math.min(MAX_FETCH, Math.max(offset + limit, limit * 5));

    try {
      const store = getStore(collection);
      await store.connect();
      await store.ensureCollection();
      const raw = await store.query(q, fetchLimit, Object.keys(metadata).length > 0 ? metadata : undefined);
      const filtered = toHits(raw, collection)
        .filter((hit) => matchesMetadata(hit, metadata))
        .filter((hit) => withinDateRange(hit, from, to));
      const sorted = sortHits(filtered, sort.field, sort.order);
      return {
        results: sorted.slice(offset, offset + limit),
        total: sorted.length,
        offset,
        limit,
        query: q,
        mode: 'vector',
        collection,
        filters: { metadata, dateRange: { from: query.from ?? query.dateFrom, to: query.to ?? query.dateTo } },
        sort,
        vectorAvailable: true,
      };
    } catch (error) {
      set.status = 400;
      const message = error instanceof Error ? error.message : String(error);
      return { results: [], total: 0, query: q, error: 'Vector search failed', message };
    }
  }, {
    query: VectorSearchQuery,
    detail: { tags: ['vector'], menu: { group: 'hidden' }, summary: 'Vector search with filters, pagination, and sort' },
  });
}

export const vectorSearchEndpoint = createVectorSearchEndpoint();
