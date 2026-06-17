import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { attachSupersedeStatus } from '../../search/supersede-status.ts';
import { ensureVectorStoreConnected, getEmbeddingModels, type EmbeddingModelConfig } from '../../vector/factory.ts';
import { queryFanout, type FanoutStrategy } from '../../vector/fanout-query.ts';
import { loadVectorConfig } from '../../vector/config.ts';
import { QueryCache, stableCacheKey } from '../../vector/query-cache.ts';
import { FanoutQuery } from './model.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';

const cache = new QueryCache<unknown>();

export interface FanoutEndpointOptions {
  getFanoutConfig?: () => FanoutRouteConfig | undefined;
  getModels?: () => Record<string, EmbeddingModelConfig>;
  getStore?: (key: string, models: Record<string, EmbeddingModelConfig>) => Promise<Pick<VectorStoreAdapter, 'query'>>;
  cache?: QueryCache<unknown>;
}

export interface FanoutRouteConfig {
  fanout?: string[];
  strategy?: FanoutStrategy;
}

function sanitize(q: string): string {
  return q.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

function activeFanoutConfig(): FanoutRouteConfig | undefined {
  return (loadVectorConfig() as { fanout?: FanoutRouteConfig } | null)?.fanout;
}

function resolveStrategy(raw: string | undefined, configured?: FanoutStrategy): FanoutStrategy {
  return raw === 'merge' ? 'merge' : configured ?? 'merge';
}

function withSupersedeStatus(result: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(result.results)) return result;
  const results = result.results.map((item) => ({ ...(item as Record<string, unknown>) }));
  attachSupersedeStatus(sqlite, results);
  return { ...result, results };
}

function requestedBackends(
  raw: string | undefined,
  models: Record<string, EmbeddingModelConfig>,
  configured: string[] | undefined,
): string[] {
  const selectors = (raw ? raw.split(',') : configured ?? Object.keys(models))
    .map((item) => item.trim())
    .filter(Boolean);
  const resolved: string[] = [];
  for (const selector of selectors) {
    if (models[selector]) resolved.push(selector);
    else resolved.push(...Object.entries(models)
      .filter(([, model]) => model.adapter === selector || model.collection === selector)
      .map(([key]) => key));
  }
  return resolved.filter((item, index) => resolved.indexOf(item) === index);
}

export function createFanoutEndpoint(options: FanoutEndpointOptions = {}) {
  const endpointCache = options.cache ?? cache;
  const getFanoutConfig = options.getFanoutConfig ?? activeFanoutConfig;
  return new Elysia()
    .get('/vector/fanout/cache', () => ({ cache: endpointCache.stats() }), { detail: { tags: ['vector'], summary: 'Fan-out query cache stats' } })
    .delete('/vector/fanout/cache', () => { endpointCache.clear(); return { success: true, cache: endpointCache.stats() }; }, { detail: { tags: ['vector'], summary: 'Clear fan-out query cache' } })
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
    const fanoutConfig = getFanoutConfig();
    const strategy = resolveStrategy(query.strategy, fanoutConfig?.strategy);
    const backends = requestedBackends(query.fanout, models, fanoutConfig?.fanout);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20')));
    if (backends.length === 0) return { query: q, strategy, backends, results: [], errors: {} };

    const cacheKey = stableCacheKey({ q, backends, limit, strategy, type: query.type ?? 'all' });
    if (query.cache !== 'false') {
      const cached = endpointCache.get(cacheKey);
      if (cached) return withSupersedeStatus({ ...(cached as Record<string, unknown>), cached: true });
    }

    const where = query.type && query.type !== 'all' ? { type: query.type } : undefined;
    const targets = await Promise.all(backends.map(async (key) => ({
      key,
      store: await (options.getStore?.(key, models) ?? ensureVectorStoreConnected(key, models)),
    })));
    const result = { query: q, ...(await queryFanout({ text: q, limit, strategy, where, targets })) };
    if (query.cache !== 'false') endpointCache.set(cacheKey, result);
    return withSupersedeStatus(result);
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
