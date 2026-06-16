/**
 * Health Routes (Elysia) — /api/health, /api/stats, /api/oracles
 */
import { Elysia } from 'elysia';
import { createHealthEndpoint, type HealthEndpointOptions } from './health.ts';
import { createDeepHealthEndpoint } from './deep.ts';
import { createStatsEndpoint } from './stats.ts';
import { createOraclesEndpoint } from './oracles.ts';
import { createOracleProfilesEndpoint } from './oracle-profiles.ts';
import { createThorOracleEndpoint } from './thor.ts';

export function createHealthRoutes(options: HealthEndpointOptions = {}) {
  return new Elysia({ prefix: '/api' })
    .use(createHealthEndpoint(options))
    .use(createDeepHealthEndpoint(options))
    .use(createStatsEndpoint())
    .use(createOraclesEndpoint())
    .use(createOracleProfilesEndpoint())
    .use(createThorOracleEndpoint());
}
