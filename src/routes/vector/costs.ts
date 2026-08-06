import { Elysia, t } from 'elysia';
import { CostEstimator } from '../../vector/cost-estimator.ts';

export interface VectorCostsEndpointOptions {
  estimator?: CostEstimator;
}

export const vectorCostEstimator = new CostEstimator();

const providerSchema = t.Union([
  t.Literal('openai'),
  t.Literal('gemini'),
  t.Literal('ollama'),
  t.Literal('local'),
  t.Literal('remote'),
  t.Literal('cloudflare-ai'),
]);

export function createVectorCostsEndpoint(options: VectorCostsEndpointOptions = {}) {
  const estimator = options.estimator ?? vectorCostEstimator;
  const snapshot = () => ({
    breakdown: estimator.getBreakdown(),
    rates: estimator.getRates(),
    usage: estimator.getUsage(),
  });

  return new Elysia()
    .get('/vector/costs', snapshot, {
      detail: { tags: ['vector'], summary: 'Embedding provider usage costs by time window' },
    })
    .post('/vector/costs/usage', ({ body, set }) => {
      const event = estimator.record(body);
      set.status = 201;
      return { event, ...snapshot() };
    }, {
      body: t.Object({
        provider: providerSchema,
        inputTokens: t.Number(),
        apiCalls: t.Optional(t.Number()),
        timestamp: t.Optional(t.String()),
      }),
      detail: { tags: ['vector'], summary: 'Record embedding provider usage for live cost tracking' },
    });
}

export const vectorCostsEndpoint = createVectorCostsEndpoint();
