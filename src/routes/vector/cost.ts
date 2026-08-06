import { Elysia, t } from 'elysia';
import { getDetectedEmbeddingProviders } from '../../vector/provider-detection.ts';
import {
  estimateEmbeddingCost,
  estimateEmbeddingCosts,
  estimateFallbackChainCost,
  isCostProvider,
  recommendEmbeddingModel,
  type CostProvider,
} from '../../vector/cost-estimation.ts';
import { getEmbeddingModels, createVectorStoreForModel, type EmbeddingModelConfig } from '../../vector/factory.ts';

export interface VectorCostEndpointOptions {
  getModels?: () => Record<string, EmbeddingModelConfig>;
  getCount?: (key: string, model: EmbeddingModelConfig) => Promise<number>;
  detectProviders?: () => Promise<{ providers: Array<{ type: string; available: boolean }> }>;
}

const providerSchema = t.Union([
  t.Literal('openai'),
  t.Literal('gemini'),
  t.Literal('ollama'),
  t.Literal('local'),
  t.Literal('remote'),
  t.Literal('cloudflare-ai'),
]);

async function defaultCount(_key: string, model: EmbeddingModelConfig): Promise<number> {
  const store = createVectorStoreForModel(model);
  try {
    await store.connect();
    return (await store.getStats()).count;
  } finally {
    await store.close().catch(() => undefined);
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function comparisonProviders(selected: CostProvider, available: string[]): CostProvider[] {
  const providers: CostProvider[] = [];
  for (const item of [selected, ...available, 'openai', 'gemini', 'ollama']) {
    if (isCostProvider(item) && !providers.includes(item)) providers.push(item);
  }
  return providers;
}

type ModelEntry = [string, EmbeddingModelConfig];

function defaultCostProvider(entries: ModelEntry[]): CostProvider {
  for (const [, model] of entries) {
    const provider = model.embedder?.backend ?? model.embedder?.default ?? model.provider;
    if (provider && isCostProvider(provider)) return provider;
  }
  return 'openai';
}

function parseFallbackChain(selected: CostProvider, raw: string | undefined, entries: ModelEntry[]): CostProvider[] {
  const providers: CostProvider[] = [selected];
  if (raw !== undefined) for (const item of raw.split(',')) addProvider(providers, item);
  else for (const [, model] of entries) {
    addProvider(providers, model.embedder?.backend ?? model.embedder?.default ?? model.provider);
    for (const provider of model.embedder?.fallbackChain ?? []) addProvider(providers, provider);
    addProvider(providers, model.embedder?.fallback);
  }
  return providers;
}

function addProvider(providers: CostProvider[], value: string | undefined): void {
  const provider = value?.trim();
  if (provider && isCostProvider(provider) && !providers.includes(provider)) providers.push(provider);
}

export function createVectorCostEndpoint(options: VectorCostEndpointOptions = {}) {
  return new Elysia().get('/vector/cost-estimate', async ({ query }) => {
    const models = options.getModels?.() ?? getEmbeddingModels();
    const entries = Object.entries(models);
    const requested = query.collection ? entries.filter(([key]) => key === query.collection) : entries;
    const counts = await Promise.all(requested.map(async ([key, model]) => options.getCount?.(key, model) ?? defaultCount(key, model)));
    const docs = query.docs ? parsePositiveInt(query.docs, 0) : counts.reduce((sum, count) => sum + count, 0);
    const provider = (query.provider as CostProvider | undefined) ?? defaultCostProvider(requested);
    const input = {
      docs,
      provider,
      model: query.model,
      tokensPerDoc: parsePositiveInt(query.tokensPerDoc, 500),
    };
    const estimate = estimateEmbeddingCost(input);
    const detected = await (options.detectProviders?.() ?? getDetectedEmbeddingProviders(false));
    const availableProviders = detected.providers.filter((item) => item.available).map((item) => item.type);
    const providerEstimates = estimateEmbeddingCosts(input, comparisonProviders(provider, availableProviders));
    const fallbackCost = estimateFallbackChainCost(input, parseFallbackChain(provider, query.fallbackChain ?? query.fallback, requested));
    return {
      ...estimate,
      collection: query.collection ?? 'all',
      collections: requested.map(([key], index) => ({ key, docs: counts[index] })),
      availableProviders,
      providerEstimates,
      fallbackChain: fallbackCost.providers,
      fallbackChainEstimates: Object.fromEntries(fallbackCost.estimates.map((item) => [item.provider, item])),
      fallbackWorstCaseUsd: fallbackCost.worstCaseUsd,
      fallbackSummary: fallbackCost.summary,
      recommendation: recommendEmbeddingModel(docs, availableProviders),
      trackingEndpoint: '/api/v1/vector/costs',
    };
  }, {
    query: t.Object({
      docs: t.Optional(t.String()),
      tokensPerDoc: t.Optional(t.String()),
      provider: t.Optional(providerSchema),
      model: t.Optional(t.String()),
      collection: t.Optional(t.String()),
      fallback: t.Optional(t.String()),
      fallbackChain: t.Optional(t.String()),
    }),
    detail: { tags: ['vector'], summary: 'Estimate embedding cost before remote indexing' },
  });
}

export const vectorCostEndpoint = createVectorCostEndpoint();
