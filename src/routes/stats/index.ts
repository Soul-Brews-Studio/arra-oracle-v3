import { Elysia } from 'elysia';
import { serverRequestStats, type RequestStatsTracker } from './request-stats.ts';

export function createRequestStatsRoutes(tracker: RequestStatsTracker = serverRequestStats) {
  return new Elysia({ prefix: '/api/v1' }).get('/stats', () => tracker.snapshot(), {
    detail: {
      tags: ['stats'],
      menu: { group: 'hidden' },
      summary: 'Aggregated request logging stats',
    },
  });
}

export const requestStatsRoutes = createRequestStatsRoutes();
export { createRequestStatsTracker, serverRequestStats } from './request-stats.ts';
export type { RequestStatsSnapshot, RequestStatsTracker } from './request-stats.ts';
