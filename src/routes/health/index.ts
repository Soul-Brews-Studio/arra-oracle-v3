/**
 * Health Routes (Elysia) — /api/health, /api/stats, /api/oracles
 */
import { Elysia } from 'elysia';
import { createHealthEndpoint, type HealthEndpointOptions } from './health.ts';
import { createDeepHealthEndpoint } from './deep.ts';
import { statsEndpoint } from './stats.ts';
import { oraclesEndpoint } from './oracles.ts';

export function createHealthRoutes(options: HealthEndpointOptions = {}) {
  return new Elysia({ prefix: '/api' })
    .use(createHealthEndpoint(options))
    .use(createDeepHealthEndpoint(options))
    .use(statsEndpoint)
    .use(oraclesEndpoint);
}

export const healthRoutes = createHealthRoutes();
