import { Elysia } from 'elysia';
import { handleDashboardGrowth } from '../../server/dashboard.ts';
import { GrowthQuery, normalizeGrowthPeriod } from './model.ts';

export const growthEndpoint = new Elysia().get('/dashboard/growth', ({ query }) => {
  return handleDashboardGrowth(normalizeGrowthPeriod(query.period));
}, {
  query: GrowthQuery,
  detail: {
    tags: ['dashboard'],
    menu: { group: 'hidden' },
    summary: 'Growth over a period',
  },
});
