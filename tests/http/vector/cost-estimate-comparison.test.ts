import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';

const models = {
  docs: { collection: 'oracle_docs', model: 'bge-m3', adapter: 'lancedb' as const },
};

test('GET /api/v1/vector/cost-estimate compares OpenAI, Gemini, and local costs', async () => {
  const { createVectorCostEndpoint } = await import('../../../src/routes/vector/cost.ts');
  const app = new Elysia({ prefix: '/api' }).use(createVectorCostEndpoint({
    getModels: () => models,
    getCount: async () => 34_822,
    detectProviders: async () => ({
      providers: [
        { type: 'openai', available: true },
        { type: 'gemini', available: true },
        { type: 'ollama', available: true },
      ],
    }),
  }));

  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/cost-estimate?provider=openai&tokensPerDoc=500'),
  );
  const body = await res.json() as {
    formula: string;
    providerEstimates: Record<string, { estimatedUsd: number }>;
    trackingEndpoint: string;
  };

  expect(res.status).toBe(200);
  expect(body.formula).toBe('34,822 docs × ~500 tokens/doc ≈ 17.4M tokens');
  expect(body.providerEstimates.openai.estimatedUsd).toBe(0.3482);
  expect(body.providerEstimates.gemini.estimatedUsd).toBe(0);
  expect(body.providerEstimates.ollama.estimatedUsd).toBe(0);
  expect(body.trackingEndpoint).toBe('/api/v1/vector/costs');
});
