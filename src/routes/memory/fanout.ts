import { Elysia } from 'elysia';
import type { SearchResult } from '../../server/types.ts';
import { ensureVectorStoreConnected, getEmbeddingModels, type EmbeddingModelConfig } from '../../vector/factory.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';
import { MemoryFanoutQuery } from './model.ts';

type QueryStore = Pick<VectorStoreAdapter, 'query'>;

type MemoryFanoutDeps = {
  models?: () => Record<string, EmbeddingModelConfig>;
  connect?: (key: string, models: Record<string, EmbeddingModelConfig>) => Promise<QueryStore>;
};

type RankedResult = SearchResult & {
  fusedScore: number;
  matches: Array<{ collection: string; rank: number; score: number }>;
};

const RRF_K = 60;

function sanitize(q: string): string {
  return q.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

function parseLimit(raw: string | undefined): number {
  return Math.min(50, Math.max(1, parseInt(raw ?? '10')));
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

function toSearchResults(collection: string, result: VectorQueryResult): SearchResult[] {
  return result.ids.map((id, index) => {
    const metadata = result.metadatas?.[index] ?? {};
    const distance = result.distances?.[index] ?? 0;
    return {
      id,
      type: metadata.type ?? 'unknown',
      content: result.documents?.[index] ?? '',
      source_file: metadata.source_file ?? metadata.path ?? '',
      concepts: Array.isArray(metadata.concepts) ? metadata.concepts : [],
      source: 'vector',
      score: 1 / (1 + distance / 100),
      distance,
      model: collection,
    };
  });
}

export function fuseRankedResults(byCollection: Record<string, SearchResult[]>, limit: number): RankedResult[] {
  const fused = new Map<string, RankedResult>();
  for (const [collection, results] of Object.entries(byCollection)) {
    results.forEach((result, index) => {
      const rank = index + 1;
      const contribution = 1 / (RRF_K + rank);
      const score = result.score ?? 0;
      const existing = fused.get(result.id);
      if (!existing) {
        fused.set(result.id, {
          ...result,
          fusedScore: contribution,
          matches: [{ collection, rank, score }],
        });
        return;
      }
      if (score > (existing.score ?? 0)) Object.assign(existing, result);
      existing.fusedScore += contribution;
      existing.matches.push({ collection, rank, score });
      existing.source = 'hybrid';
    });
  }
  return [...fused.values()]
    .map((item) => ({ ...item, fusedScore: +item.fusedScore.toFixed(6) }))
    .sort((a, b) => b.fusedScore - a.fusedScore || (b.score ?? 0) - (a.score ?? 0))
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
    const limit = parseLimit(query.limit);
    const errors: Record<string, string> = {};
    const byCollection: Record<string, SearchResult[]> = {};

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
      results: fuseRankedResults(byCollection, limit),
      errors,
      cost: estimateCost(q, collections),
    };
  }, {
    query: MemoryFanoutQuery,
    detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Fanout memory search across vector collections' },
  });
}
