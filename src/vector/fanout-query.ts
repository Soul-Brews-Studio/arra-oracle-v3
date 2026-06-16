import type { SearchResult } from '../server/types.ts';
import type { VectorQueryResult, VectorStoreAdapter } from './types.ts';

export type FanoutStrategy = 'merge';

export interface FanoutQueryTarget {
  key: string;
  store: Pick<VectorStoreAdapter, 'query'>;
}

export interface FanoutQueryOptions {
  text: string;
  limit: number;
  where?: Record<string, unknown>;
  targets: FanoutQueryTarget[];
  strategy?: FanoutStrategy;
}

export interface FanoutQueryResponse {
  strategy: FanoutStrategy;
  backends: string[];
  results: SearchResult[];
  errors: Record<string, string>;
}

export async function queryFanout(options: FanoutQueryOptions): Promise<FanoutQueryResponse> {
  const settled = await Promise.allSettled(options.targets.map(async (target) => ({
    key: target.key,
    result: await target.store.query(options.text, options.limit, options.where),
  })));
  const errors: Record<string, string> = {};
  const results: SearchResult[] = [];
  settled.forEach((item, index) => {
    const key = options.targets[index].key;
    if (item.status === 'rejected') {
      errors[key] = item.reason instanceof Error ? item.reason.message : String(item.reason);
      return;
    }
    results.push(...toSearchResults(key, item.value.result));
  });
  return {
    strategy: options.strategy ?? 'merge',
    backends: options.targets.map((target) => target.key),
    results: mergeFanoutResults(results).slice(0, options.limit),
    errors,
  };
}

export function mergeFanoutResults(results: SearchResult[]): SearchResult[] {
  const best = new Map<string, SearchResult & { _hits?: number }>();
  for (const result of results) {
    const existing = best.get(result.id);
    if (!existing) {
      best.set(result.id, { ...result, _hits: 1 });
      continue;
    }
    const hits = (existing._hits ?? 1) + 1;
    const score = Math.min(1, Math.max(existing.score ?? 0, result.score ?? 0) + 0.05 * (hits - 1));
    best.set(result.id, { ...(score >= (result.score ?? 0) ? existing : result), score, source: 'hybrid', _hits: hits });
  }
  return [...best.values()]
    .map(({ _hits, ...result }) => result)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function toSearchResults(backend: string, result: VectorQueryResult): SearchResult[] {
  return result.ids.map((id, i) => {
    const distance = result.distances?.[i] ?? 0;
    return {
      id,
      type: result.metadatas?.[i]?.type ?? 'unknown',
      content: result.documents?.[i] ?? '',
      source_file: result.metadatas?.[i]?.source_file ?? '',
      concepts: [],
      source: 'vector' as const,
      score: 1 / (1 + distance / 100),
      distance,
      model: backend,
    };
  });
}
