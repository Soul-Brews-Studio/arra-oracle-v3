import { Elysia } from 'elysia';
import { ensureVectorStoreConnected, getEmbeddingModels, type EmbeddingModelConfig } from '../../vector/factory.ts';
import { queryFanout } from '../../vector/fanout-query.ts';
import { QueryCache, stableCacheKey } from '../../vector/query-cache.ts';
import { FanoutQuery } from './model.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';

const cache = new QueryCache<unknown>();

export interface FanoutEndpointOptions {
  getModels?: () => Record<string, EmbeddingModelConfig>;
  getStore?: (key: string, models: Record<string, EmbeddingModelConfig>) => Promise<Pick<VectorStoreAdapter, 'query'>>;
}

function sanitize(q: string): string {
  return q.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

function requestedBackends(raw: string | undefined, enabled: string[]): string[] {
  const requested = (raw ? raw.split(',') : enabled).map((item) => item.trim()).filter(Boolean);
  return requested.filter((item, index) => enabled.includes(item) && requested.indexOf(item) === index);
}

export function createFanoutEndpoint(options: FanoutEndpointOptions = {}) {
  return new Elysia()
    .get('/vector/fanout/cache', () => ({ cache: cache.stats() }), { detail: { tags: ['vector'], summary: 'Fan-out query cache stats' } })
    .delete('/vector/fanout/cache', () => { cache.clear(); return { success: true, cache: cache.stats() }; }, { detail: { tags: ['vector'], summary: 'Clear fan-out query cache' } })
    .get(
      '/vector/fanout',
      async ({ query, set }) => {
    if (!query.q) {
      set.status = 400;
      return { error: 'Missing query parameter: q' };
    }
    const q = sanitize(query.q);
    if (!q) {
      set.status = 400;
      return { error: 'Invalid query: empty after sanitization' };
    }

    const models = options.getModels?.() ?? getEmbeddingModels();
    const backends = requestedBackends(query.fanout, Object.keys(models));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20')));
    if (backends.length === 0) return { query: q, strategy: 'merge', backends, results: [], errors: {} };

    const cacheKey = stableCacheKey({ q, backends, limit, type: query.type ?? 'all' });
    if (query.cache !== 'false') {
      const cached = cache.get(cacheKey);
      if (cached) return { ...(cached as Record<string, unknown>), cached: true };
    }

    const where = query.type && query.type !== 'all' ? { type: query.type } : undefined;
    const targets = await Promise.all(backends.map(async (key) => ({
      key,
      store: await (options.getStore?.(key, models) ?? ensureVectorStoreConnected(key, models)),
    })));
    const result = { query: q, ...(await queryFanout({ text: q, limit, where, targets })) };
    if (query.cache !== 'false') cache.set(cacheKey, result);
    return result;
      },
      {
        query: FanoutQuery,
        detail: {
          tags: ['vector'],
          menu: { group: 'hidden' },
          summary: 'Fan out vector search across configured collections/backends',
        },
      },
    );
}

export const fanoutEndpoint = createFanoutEndpoint();
