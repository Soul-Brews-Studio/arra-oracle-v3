import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { CostEstimator } from '../../../src/vector/cost-estimator.ts';
import { createVectorCostsEndpoint } from '../../../src/routes/vector/costs.ts';

const now = new Date('2026-06-16T12:00:00Z');

function fetcher(estimator: CostEstimator) {
  const app = new Elysia({ prefix: '/api' }).use(createVectorCostsEndpoint({ estimator }));
  return createApiVersionedFetch((request) => app.handle(request));
}

test('CostEstimator tracks usage and priced provider breakdowns', () => {
  const estimator = new CostEstimator({
    now: () => now,
    rates: { openai: 0.1, gemini: 0.02 },
  });

  estimator.record({
    provider: 'openai',
    inputTokens: 1_000_000,
    apiCalls: 2,
    timestamp: '2026-06-16T08:00:00Z',
  });
  estimator.record({
    provider: 'gemini',
    inputTokens: 500_000,
    timestamp: '2026-06-15T08:00:00Z',
  });
  estimator.record({
    provider: 'cloudflare-ai',
    inputTokens: 250_000,
    apiCalls: 3,
    timestamp: '2026-05-25T08:00:00Z',
  });
  estimator.record({
    provider: 'remote',
    inputTokens: 10_000,
    timestamp: '2026-05-01T08:00:00Z',
  });

  const breakdown = estimator.getBreakdown(now);
  expect(breakdown.daily).toMatchObject({
    window: 'daily',
    inputTokens: 1_000_000,
    apiCalls: 2,
    estimatedUsd: 0.1,
    providers: { openai: { inputTokens: 1_000_000, apiCalls: 2, estimatedUsd: 0.1 } },
  });
  expect(breakdown.weekly).toMatchObject({
    inputTokens: 1_500_000,
    apiCalls: 3,
    estimatedUsd: 0.11,
  });
  expect(breakdown.weekly.providers.gemini).toMatchObject({
    inputTokens: 500_000,
    apiCalls: 1,
    estimatedUsd: 0.01,
  });
  expect(breakdown.monthly).toMatchObject({
    inputTokens: 1_750_000,
    apiCalls: 6,
    estimatedUsd: 0.112,
  });
  expect(breakdown.monthly.providers.remote).toBeUndefined();
});

test('GET /api/v1/vector/costs returns usage, rates, and time windows', async () => {
  const estimator = new CostEstimator({ now: () => now, rates: { openai: 0.1 } });
  estimator.record({ provider: 'openai', inputTokens: 250_000, apiCalls: 4 });
  estimator.record({
    provider: 'ollama',
    inputTokens: 50_000,
    timestamp: '2026-06-10T12:00:00Z',
  });

  const res = await fetcher(estimator)(new Request('http://local/api/v1/vector/costs'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.rates.openai).toBe(0.1);
  expect(body.usage).toHaveLength(2);
  expect(body.breakdown.daily).toMatchObject({
    window: 'daily',
    inputTokens: 250_000,
    apiCalls: 4,
    estimatedUsd: 0.025,
  });
  expect(body.breakdown.weekly.providers.ollama).toMatchObject({
    inputTokens: 50_000,
    apiCalls: 1,
    estimatedUsd: 0,
  });
  expect(body.breakdown.monthly.inputTokens).toBe(300_000);
});
