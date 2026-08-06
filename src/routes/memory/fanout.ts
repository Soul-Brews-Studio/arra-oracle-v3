import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { augmentQueryWithAcronyms } from '../../search/acronyms.ts';
import { parseAsOf } from '../../search/bitemporal.ts';
import { entitySignalsForCandidates, type EntitySignal } from '../../search/entity-ranking.ts';
import { attachSupersedeStatus, supersedeWarnings } from '../../search/supersede-status.ts';
import type { SearchResult } from '../../server/types.ts';
import { ensureVectorStoreConnected, getEmbeddingModels, type EmbeddingModelConfig } from '../../vector/factory.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';
import { asOfResponse } from '../search/asof.ts';
import { memoryConfidence, type MemoryConfidence } from './confidence.ts';
import { fanoutVectorWhere, filterFanoutCandidates } from './fanout-filter.ts';
import { toFanoutSearchResults, type FanoutSearchResult } from './fanout-results.ts';
import { estimateFanoutCost } from './fanout-cost.ts';
import { MemoryFanoutQuery, parseMemoryLimit } from './model.ts';
import { scheduleMemoryReinforcement } from './reinforcement.ts';
import { clampMemoryConfidenceWeight, memoryConfidenceRerankConfig, memoryFanoutConfidenceWeight } from './rerank-config.ts';
import type { MemoryRecord } from './store.ts';

type QueryStore = Pick<VectorStoreAdapter, 'query'>;

type MemoryFanoutDeps = {
  models?: () => Record<string, EmbeddingModelConfig>;
  connect?: (key: string, models: Record<string, EmbeddingModelConfig>) => Promise<QueryStore>;
  confidenceWeight?: number;
  reinforce?: (ids: string[]) => void | Promise<void>;
  now?: () => Date;
};

type RankedResult = SearchResult & {
  fusedScore: number;
  rankingScore: number;
  confidenceWeight: number;
  confidence: MemoryConfidence;
  entitySignal?: EntitySignal;
  matches: Array<{ collection: string; rank: number; score: number }>;
};

const RRF_K = 60;

function sanitize(q: string): string {
  return q.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

function confidenceFor(result: FanoutSearchResult, now: Date, usageWeight?: number): MemoryConfidence {
  const timestamp = result.updatedAt ?? result.createdAt ?? new Date(0).toISOString();
  const memory: MemoryRecord = {
    id: result.id,
    content: result.content,
    title: result.title,
    tags: result.tags?.length ? result.tags : result.concepts,
    source: result.memorySource,
    createdAt: result.createdAt ?? timestamp,
    updatedAt: result.updatedAt ?? timestamp,
    usageCount: result.usageCount,
    lastAccessedAt: result.lastAccessedAt,
  };
  return memoryConfidence(memory, { mode: 'semantic', semanticScore: result.score ?? 0, now, usageWeight });
}

function round6(value: number): number {
  return +value.toFixed(6);
}

export function fanoutEntitySignalConfig(confidenceWeight: number) {
  const weight = round6(Math.min(0.06, confidenceWeight / 4));
  return { enabled: weight > 0, source: 'oracle_entity_links' as const, weight, graph: false };
}

export function fuseRankedResults(
  byCollection: Record<string, SearchResult[]>,
  limit: number,
  options: { confidenceWeight?: number; usageWeight?: number; now?: Date; entitySignals?: Map<string, EntitySignal> } = {},
): RankedResult[] {
  const fused = new Map<string, RankedResult>();
  const weight = options.confidenceWeight === undefined
    ? memoryFanoutConfidenceWeight()
    : clampMemoryConfidenceWeight(options.confidenceWeight);
  const entityConfig = fanoutEntitySignalConfig(weight);
  const confidencePart = weight - entityConfig.weight;
  const now = options.now ?? new Date();
  for (const [collection, results] of Object.entries(byCollection)) {
    results.forEach((result, index) => {
      const candidate = result as FanoutSearchResult;
      const rank = index + 1;
      const contribution = 1 / (RRF_K + rank);
      const score = result.score ?? 0;
      const confidence = confidenceFor(candidate, now, options.usageWeight);
      const existing = fused.get(result.id);
      if (!existing) {
        fused.set(result.id, {
          ...result,
          confidence,
          entitySignal: options.entitySignals?.get(result.id),
          fusedScore: contribution,
          rankingScore: 0,
          confidenceWeight: weight,
          matches: [{ collection, rank, score }],
        });
        return;
      }
      if (score > (existing.score ?? 0) || confidence.score > existing.confidence.score) {
        Object.assign(existing, result, { confidence });
      }
      existing.entitySignal ??= options.entitySignals?.get(result.id);
      existing.fusedScore += contribution;
      existing.matches.push({ collection, rank, score });
      existing.source = 'hybrid';
    });
  }
  const maxFusedScore = Math.max(0, ...[...fused.values()].map((item) => item.fusedScore));
  return [...fused.values()]
    .map((item) => {
      const rrf = maxFusedScore ? item.fusedScore / maxFusedScore : 0;
      const { entitySignal, ...result } = item;
      const entity = entitySignal?.score ?? 0;
      return {
        ...result,
        ...(entity ? { entity_score: round6(entity), entity_matches: entitySignal?.matches ?? [] } : {}),
        fusedScore: round6(item.fusedScore),
        rankingScore: round6((rrf * (1 - weight)) + (item.confidence.score * confidencePart) + (entity * entityConfig.weight)),
      };
    })
    .sort((a, b) => b.rankingScore - a.rankingScore || b.fusedScore - a.fusedScore || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

export function createMemoryFanoutEndpoint(deps: MemoryFanoutDeps = {}) {
  const listModels = deps.models ?? getEmbeddingModels;
  const connect = deps.connect ?? ensureVectorStoreConnected;

  return new Elysia().get('/memory/fanout', async ({ query, set }) => {
    if (!query.q) {
      set.status = 400;
      return { error: 'Missing query parameter: q' };
    }
    const q = sanitize(query.q);
    if (!q) {
      set.status = 400;
      return { error: 'Invalid query: empty after sanitization' };
    }

    const models = listModels();
    const collections = Object.keys(models);
    const limit = parseMemoryLimit(query.limit);
    const asOf = parseAsOf(query.asOf);
    if (!asOf.ok) {
      set.status = 400;
      return { error: asOf.error };
    }
    const errors: Record<string, string> = {};
    const byCollection: Record<string, SearchResult[]> = {};
    const where = fanoutVectorWhere();
    const rerankConfig = memoryConfidenceRerankConfig();
    const configuredConfidenceWeight = deps.confidenceWeight === undefined
      ? rerankConfig.confidenceWeight
      : clampMemoryConfidenceWeight(deps.confidenceWeight);
    const entitySignalConfig = fanoutEntitySignalConfig(configuredConfidenceWeight);

    const settled = await Promise.allSettled(collections.map(async (key) => {
      const store = await connect(key, models);
      return { key, result: await store.query(q, limit, where) };
    }));

    settled.forEach((item, index) => {
      const key = collections[index];
      if (item.status === 'rejected') {
        errors[key] = item.reason instanceof Error ? item.reason.message : String(item.reason);
        return;
      }
      byCollection[key] = filterFanoutCandidates(
        sqlite,
        toFanoutSearchResults(key, item.value.result),
        asOf.value,
      );
    });
    const candidateIds = Object.values(byCollection).flatMap((results) => results.map((result) => result.id));
    const entitySignals = entitySignalConfig.enabled
      ? entitySignalsForCandidates(sqlite, candidateIds, augmentQueryWithAcronyms(q), currentTenantId())
      : undefined;

    const results = fuseRankedResults(byCollection, limit, {
      confidenceWeight: configuredConfidenceWeight,
      entitySignals,
      now: deps.now?.(),
    });
    attachSupersedeStatus(sqlite, results as unknown as Array<Record<string, unknown>>);
    const warnings = supersedeWarnings(results as unknown as Array<Record<string, unknown>>);
    scheduleMemoryReinforcement(results, deps.reinforce);

    return {
      query: q,
      strategy: 'reciprocal_rank_fusion',
      collections,
      totalCollections: collections.length,
      ranking: {
        strategy: rerankConfig.strategy,
        rrfK: RRF_K,
        confidenceWeight: configuredConfidenceWeight,
        confidenceRerankingEnabled: configuredConfidenceWeight > 0,
        confidenceWeightSource: deps.confidenceWeight === undefined ? rerankConfig.source : 'injected',
        confidenceSource: rerankConfig.confidenceSource,
        entitySignal: entitySignalConfig,
      },
      results,
      ...(warnings.length ? { warnings } : {}),
      ...asOfResponse(asOf.value),
      errors,
      cost: estimateFanoutCost(q, collections),
    };
  }, {
    query: MemoryFanoutQuery,
    detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Fanout memory search across vector collections' },
  });
}
