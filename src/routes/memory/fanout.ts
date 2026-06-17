import { Elysia } from 'elysia';
import type { SearchResult } from '../../server/types.ts';
import { ensureVectorStoreConnected, getEmbeddingModels, type EmbeddingModelConfig } from '../../vector/factory.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';
import { memoryConfidence, type MemoryConfidence } from './confidence.ts';
import { safeVectorDistance, scoreFromVectorDistance } from './fanout-score.ts';
import { MemoryFanoutQuery, parseMemoryLimit } from './model.ts';
import { clampMemoryConfidenceWeight, memoryConfidenceRerankConfig, memoryFanoutConfidenceWeight } from './rerank-config.ts';
import type { MemoryRecord } from './store.ts';

type QueryStore = Pick<VectorStoreAdapter, 'query'>;

type MemoryFanoutDeps = {
  models?: () => Record<string, EmbeddingModelConfig>;
  connect?: (key: string, models: Record<string, EmbeddingModelConfig>) => Promise<QueryStore>;
  confidenceWeight?: number;
  now?: () => Date;
};

type FanoutSearchResult = SearchResult & {
  title?: string;
  tags?: string[];
  memorySource?: string;
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number;
  lastAccessedAt?: string;
};

type RankedResult = SearchResult & {
  fusedScore: number;
  rankingScore: number;
  confidenceWeight: number;
  confidence: MemoryConfidence;
  matches: Array<{ collection: string; rank: number; score: number }>;
};

const RRF_K = 60;

function sanitize(q: string): string {
  return q.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateCost(query: string, collections: string[]) {
  const inputTokens = estimateTokens(query);
  const vectorQueries = collections.length;
  return {
    inputTokens,
    vectorQueries,
    embeddingCalls: vectorQueries,
    estimatedTokenUnits: inputTokens * vectorQueries,
    estimatedUsd: 0,
    note: 'Local vector collections have no metered API cost; token units estimate remote embedder exposure.',
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return text(value);
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return textList(parsed);
  } catch {}
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function toSearchResults(collection: string, result: VectorQueryResult): FanoutSearchResult[] {
  return result.ids.map((id, index) => {
    const metadata = result.metadatas?.[index] ?? {};
    const distance = safeVectorDistance(result.distances?.[index]);
    const tags = textList(metadata.tags).length ? textList(metadata.tags) : textList(metadata.concepts);
    return {
      id,
      type: metadata.type ?? 'unknown',
      content: result.documents?.[index] ?? '',
      source_file: metadata.source_file ?? metadata.path ?? '',
      concepts: textList(metadata.concepts),
      source: 'vector',
      score: scoreFromVectorDistance(distance),
      distance,
      model: collection,
      title: text(metadata.title),
      tags,
      memorySource: text(metadata.source ?? metadata.memory_source ?? metadata.source_file ?? metadata.path),
      createdAt: dateText(metadata.createdAt ?? metadata.created_at),
      updatedAt: dateText(metadata.updatedAt ?? metadata.updated_at),
      usageCount: numberValue(metadata.usageCount ?? metadata.usage_count),
      lastAccessedAt: dateText(metadata.lastAccessedAt ?? metadata.last_accessed_at),
      superseded_by: text(metadata.superseded_by ?? metadata.supersededBy),
      superseded_at: dateText(metadata.superseded_at ?? metadata.supersededAt),
      superseded_reason: text(metadata.superseded_reason ?? metadata.supersededReason),
    };
  });
}

function confidenceFor(result: FanoutSearchResult, now: Date): MemoryConfidence {
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
  return memoryConfidence(memory, { mode: 'semantic', semanticScore: result.score ?? 0, now });
}

function round6(value: number): number {
  return +value.toFixed(6);
}

export function fuseRankedResults(
  byCollection: Record<string, SearchResult[]>,
  limit: number,
  options: { confidenceWeight?: number; now?: Date } = {},
): RankedResult[] {
  const fused = new Map<string, RankedResult>();
  const weight = options.confidenceWeight === undefined
    ? memoryFanoutConfidenceWeight()
    : clampMemoryConfidenceWeight(options.confidenceWeight);
  const now = options.now ?? new Date();
  for (const [collection, results] of Object.entries(byCollection)) {
    results.forEach((result, index) => {
      const candidate = result as FanoutSearchResult;
      const rank = index + 1;
      const contribution = 1 / (RRF_K + rank);
      const score = result.score ?? 0;
      const confidence = confidenceFor(candidate, now);
      const existing = fused.get(result.id);
      if (!existing) {
        fused.set(result.id, {
          ...result,
          confidence,
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
      existing.fusedScore += contribution;
      existing.matches.push({ collection, rank, score });
      existing.source = 'hybrid';
    });
  }
  const maxFusedScore = Math.max(0, ...[...fused.values()].map((item) => item.fusedScore));
  return [...fused.values()]
    .map((item) => {
      const rrf = maxFusedScore ? item.fusedScore / maxFusedScore : 0;
      return {
        ...item,
        fusedScore: round6(item.fusedScore),
        rankingScore: round6((rrf * (1 - weight)) + (item.confidence.score * weight)),
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
    const errors: Record<string, string> = {};
    const byCollection: Record<string, SearchResult[]> = {};
    const rerankConfig = memoryConfidenceRerankConfig();
    const configuredConfidenceWeight = deps.confidenceWeight === undefined
      ? rerankConfig.confidenceWeight
      : clampMemoryConfidenceWeight(deps.confidenceWeight);

    const settled = await Promise.allSettled(collections.map(async (key) => {
      const store = await connect(key, models);
      return { key, result: await store.query(q, limit) };
    }));

    settled.forEach((item, index) => {
      const key = collections[index];
      if (item.status === 'rejected') {
        errors[key] = item.reason instanceof Error ? item.reason.message : String(item.reason);
        return;
      }
      byCollection[key] = toSearchResults(key, item.value.result);
    });

    return {
      query: q,
      strategy: 'reciprocal_rank_fusion',
      collections,
      totalCollections: collections.length,
      ranking: {
        rrfK: RRF_K,
        confidenceWeight: configuredConfidenceWeight,
        confidenceRerankingEnabled: configuredConfidenceWeight > 0,
        confidenceWeightSource: deps.confidenceWeight === undefined ? rerankConfig.source : 'injected',
        confidenceSource: rerankConfig.confidenceSource,
      },
      results: fuseRankedResults(byCollection, limit, {
        confidenceWeight: configuredConfidenceWeight,
        now: deps.now?.(),
      }),
      errors,
      cost: estimateCost(q, collections),
    };
  }, {
    query: MemoryFanoutQuery,
    detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Fanout memory search across vector collections' },
  });
}
