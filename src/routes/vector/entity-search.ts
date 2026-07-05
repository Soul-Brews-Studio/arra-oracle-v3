import { Elysia, t } from 'elysia';
import { currentTenantId } from '../../middleware/tenant.ts';
import { entityCollectionName } from '../../vector/entities.ts';
import { createVectorStoreForModel, getEmbeddingModels, type EmbeddingModelConfig } from '../../vector/factory.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';

type EntityStore = Pick<VectorStoreAdapter, 'connect' | 'ensureCollection' | 'query'> & Partial<Pick<VectorStoreAdapter, 'close'>>;

type EntitySearchDeps = {
  getModels?: () => Record<string, EmbeddingModelConfig>;
  createStore?: (preset: EmbeddingModelConfig) => EntityStore;
};

const MAX_LIMIT = 50;
const EntitySearchQuery = t.Object({
  q: t.Optional(t.String()),
  model: t.Optional(t.String()),
  collection: t.Optional(t.String()),
  limit: t.Optional(t.String()),
});

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
  return trimmed || undefined;
}

function limitOf(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Math.min(MAX_LIMIT, Number.isFinite(parsed) && parsed > 0 ? parsed : 10);
}

function resolvePreset(name: string | undefined, models: Record<string, EmbeddingModelConfig>): EmbeddingModelConfig | undefined {
  if (name && models[name]) return models[name];
  if (name) return Object.values(models).find((preset) => preset.collection === name);
  return models['bge-m3'] ?? Object.values(models)[0];
}

function metadataAt(result: VectorQueryResult, index: number): Record<string, unknown> {
  const value = result.metadatas?.[index];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toHits(result: VectorQueryResult) {
  return result.ids.map((id, index) => {
    const metadata = metadataAt(result, index);
    return {
      id,
      entity: String(metadata.entity ?? result.documents?.[index] ?? ''),
      sourceDocId: String(metadata.source_doc_id ?? ''),
      tenantId: String(metadata.tenant_id ?? ''),
      score: 1 / (1 + Number(result.distances?.[index] ?? 0) / 100),
      distance: Number(result.distances?.[index] ?? 0),
      metadata,
    };
  });
}

export function createEntitySearchEndpoint(deps: EntitySearchDeps = {}) {
  const getModels = deps.getModels ?? getEmbeddingModels;
  const createStore = deps.createStore ?? createVectorStoreForModel;

  return new Elysia().get('/vector/entities/search', async ({ query, set }) => {
    const q = clean(query.q);
    if (!q) {
      set.status = 400;
      return { error: 'Missing query parameter: q' };
    }

    const preset = resolvePreset(query.model ?? query.collection, getModels());
    if (!preset) {
      set.status = 404;
      return { error: 'No embedding models configured' };
    }

    const entityCollection = entityCollectionName(preset.collection);
    const tenantId = currentTenantId();
    const filters = tenantId ? { tenant_id: tenantId } : undefined;
    const store = createStore({ ...preset, collection: entityCollection });

    try {
      await store.connect();
      await store.ensureCollection();
      const result = await store.query(q, limitOf(query.limit), filters);
      return {
        query: q,
        mode: 'entity-vector',
        collection: entityCollection,
        model: query.model ?? query.collection ?? null,
        filters: { metadata: filters ?? {} },
        results: toHits(result),
      };
    } catch (error) {
      set.status = 400;
      return { results: [], error: 'Entity search failed', message: error instanceof Error ? error.message : String(error) };
    } finally {
      await store.close?.().catch(() => undefined);
    }
  }, {
    query: EntitySearchQuery,
    detail: { tags: ['vector'], summary: 'Search entity-linking sidecar collection' },
  });
}

export const entitySearchEndpoint = createEntitySearchEndpoint();
