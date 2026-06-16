import { Elysia, t } from 'elysia';
import { getDetectedEmbeddingProviders } from '../../vector/provider-detection.ts';
import {
  estimateEmbeddingCost,
  estimateEmbeddingCosts,
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

export function createVectorCostEndpoint(options: VectorCostEndpointOptions = {}) {
  return new Elysia().get('/vector/cost-estimate', async ({ query }) => {
    const models = options.getModels?.() ?? getEmbeddingModels();
    const entries = Object.entries(models);
    const requested = query.collection ? entries.filter(([key]) => key === query.collection) : entries;
    const counts = await Promise.all(requested.map(async ([key, model]) => options.getCount?.(key, model) ?? defaultCount(key, model)));
    const docs = query.docs ? parsePositiveInt(query.docs, 0) : counts.reduce((sum, count) => sum + count, 0);
    const provider = (query.provider ?? 'openai') as CostProvider;
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
    return {
      ...estimate,
      collection: query.collection ?? 'all',
      collections: requested.map(([key], index) => ({ key, docs: counts[index] })),
      availableProviders,
      providerEstimates,
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
    }),
    detail: { tags: ['vector'], summary: 'Estimate embedding cost before remote indexing' },
  });
}

export const vectorCostEndpoint = createVectorCostEndpoint();
