import { Elysia } from 'elysia';
import { CostEstimator } from '../../vector/cost-estimator.ts';

export interface VectorCostsEndpointOptions {
  estimator?: CostEstimator;
}

export const vectorCostEstimator = new CostEstimator();

export function createVectorCostsEndpoint(options: VectorCostsEndpointOptions = {}) {
  const estimator = options.estimator ?? vectorCostEstimator;
  return new Elysia().get('/vector/costs', () => ({
    breakdown: estimator.getBreakdown(),
    rates: estimator.getRates(),
    usage: estimator.getUsage(),
  }), {
    detail: { tags: ['vector'], summary: 'Embedding provider usage costs by time window' },
  });
}

export const vectorCostsEndpoint = createVectorCostsEndpoint();
