import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorCostEndpoint } from '../../../src/routes/vector/cost.ts';

test('GET /api/v1/vector/cost-estimate reports fallback-chain worst-case spend', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorCostEndpoint({
    getModels: () => ({
      docs: { collection: 'oracle_docs', model: 'bge-m3', adapter: 'lancedb' as const },
    }),
    getCount: async () => 34_822,
    detectProviders: async () => ({
      providers: [
        { type: 'ollama', available: true },
        { type: 'gemini', available: true },
        { type: 'openai', available: true },
      ],
    }),
  }));

  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/cost-estimate?provider=ollama&fallbackChain=gemini,openai&tokensPerDoc=500'),
  );
  const body = await res.json() as {
    fallbackChain: string[];
    fallbackChainEstimates: Record<string, { estimatedUsd: number }>;
    fallbackSummary: string;
    fallbackWorstCaseUsd: number;
  };

  expect(res.status).toBe(200);
  expect(body.fallbackChain).toEqual(['ollama', 'gemini', 'openai']);
  expect(body.fallbackChainEstimates.ollama.estimatedUsd).toBe(0);
  expect(body.fallbackChainEstimates.gemini.estimatedUsd).toBe(0);
  expect(body.fallbackChainEstimates.openai.estimatedUsd).toBe(0.3482);
  expect(body.fallbackWorstCaseUsd).toBe(0.3482);
  expect(body.fallbackSummary).toContain('ollama → gemini → openai');
});

test('GET /api/v1/vector/cost-estimate derives fallback chain from config', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorCostEndpoint({
    getModels: () => ({
      docs: {
        collection: 'oracle_docs',
        model: 'bge-m3',
        adapter: 'lancedb' as const,
        embedder: { backend: 'ollama', fallbackChain: ['gemini', 'openai'] },
      },
    }),
    getCount: async () => 100,
    detectProviders: async () => ({ providers: [] }),
  }));

  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/cost-estimate?tokensPerDoc=500'),
  );
  const body = await res.json() as { provider: string; fallbackChain: string[]; fallbackSummary: string };

  expect(res.status).toBe(200);
  expect(body.provider).toBe('ollama');
  expect(body.fallbackChain).toEqual(['ollama', 'gemini', 'openai']);
  expect(body.fallbackSummary).toContain('ollama → gemini → openai');
});
