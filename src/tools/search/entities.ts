import { currentTenantId } from '../../middleware/tenant.ts';
import { entityCollectionName } from '../../vector/entities.ts';
import {
  createVectorStoreForModel,
  getEmbeddingModels,
  type EmbeddingModelConfig,
} from '../../vector/factory.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';
import type { ToolContext } from '../types.ts';
import type { CombinedSearchResult } from './types.ts';

export type EntityLinkHit = {
  sourceDocId: string;
  entity: string;
  score: number;
  distance?: number;
};

export type EntityLinkSearchHook = (
  query: string,
  limit: number,
  model?: string,
) => EntityLinkHit[] | Promise<EntityLinkHit[]>;

type EntityLinkContext = ToolContext & { entityLinkSearch?: EntityLinkSearchHook };
type EntityStore = Pick<VectorStoreAdapter, 'connect' | 'ensureCollection' | 'query'>
  & Partial<Pick<VectorStoreAdapter, 'close'>>;

const DEFAULT_WEIGHT = 0.25;
const MAX_LIMIT = 50;
const MAX_MATCHES = 5;

export function hasEntityLinkSearchHook(ctx: ToolContext): boolean {
  return typeof (ctx as EntityLinkContext).entityLinkSearch === 'function';
}

export function applyEntityLinkBoost(
  results: CombinedSearchResult[],
  hits: EntityLinkHit[],
  weight = DEFAULT_WEIGHT,
): { results: CombinedSearchResult[]; boosted: number } {
  if (results.length === 0 || hits.length === 0 || weight <= 0) return { results, boosted: 0 };
  const links = aggregateHits(hits);
  let boosted = 0;
  const ranked = results.map((result, index) => {
    const link = links.get(result.id);
    if (!link) return { result, index };
    const boostedScore = clamp(result.score + link.score * weight);
    if (boostedScore > result.score) boosted += 1;
    return {
      result: {
        ...result,
        score: boostedScore,
        entityLinkScore: round(link.score),
        entityLinkMatches: link.matches,
      },
      index,
    };
  });
  ranked.sort((a, b) => b.result.score - a.result.score || a.index - b.index);
  return { results: ranked.map((item) => item.result), boosted };
}

export async function queryEntityLinks(
  ctx: ToolContext,
  query: string,
  limit: number,
  model?: string,
): Promise<EntityLinkHit[]> {
  const hook = (ctx as EntityLinkContext).entityLinkSearch;
  if (hook) return cleanHits(await hook(query, boundedLimit(limit), model));

  const models = getEmbeddingModels();
  const preset = resolvePreset(model, models);
  if (!preset) return [];

  const store: EntityStore = createVectorStoreForModel({
    ...preset,
    collection: entityCollectionName(preset.collection),
  });
  try {
    await store.connect();
    await store.ensureCollection();
    const tenantId = currentTenantId();
    const filters = tenantId ? { tenant_id: tenantId } : undefined;
    const result = await store.query(query, boundedLimit(limit), filters);
    return cleanHits(hitsFromQuery(result));
  } finally {
    await store.close?.().catch(() => undefined);
  }
}

function resolvePreset(
  model: string | undefined,
  models: Record<string, EmbeddingModelConfig>,
): EmbeddingModelConfig | undefined {
  if (model && models[model]) return models[model];
  if (model) return Object.values(models).find((preset) => preset.collection === model);
  return models['bge-m3'] ?? Object.values(models)[0];
}

function hitsFromQuery(result: VectorQueryResult): EntityLinkHit[] {
  return result.ids.map((_, index) => {
    const metadata = metadataAt(result, index);
    const distance = Number(result.distances?.[index] ?? 0);
    return {
      sourceDocId: String(metadata.source_doc_id ?? ''),
      entity: String(metadata.entity ?? result.documents?.[index] ?? ''),
      score: 1 / (1 + Math.max(0, distance) / 100),
      distance,
    };
  });
}

function aggregateHits(hits: EntityLinkHit[]): Map<string, { score: number; matches: string[] }> {
  const grouped = new Map<string, { score: number; matches: string[] }>();
  for (const hit of cleanHits(hits)) {
    const existing = grouped.get(hit.sourceDocId) ?? { score: 0, matches: [] };
    existing.score = Math.max(existing.score, hit.score);
    if (hit.entity && !existing.matches.includes(hit.entity) && existing.matches.length < MAX_MATCHES) {
      existing.matches.push(hit.entity);
    }
    grouped.set(hit.sourceDocId, existing);
  }
  return grouped;
}

function cleanHits(hits: EntityLinkHit[]): EntityLinkHit[] {
  return hits
    .filter((hit) => hit.sourceDocId.trim().length > 0)
    .map((hit) => ({ ...hit, score: clamp(hit.score), entity: hit.entity.trim() }));
}

function metadataAt(result: VectorQueryResult, index: number): Record<string, unknown> {
  const value = result.metadatas?.[index];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedLimit(limit: number): number {
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit) || 10));
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
