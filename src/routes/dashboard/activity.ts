import { Elysia } from 'elysia';
import { handleDashboardActivity } from '../../server/dashboard.ts';
import { ActivityQuery, normalizeActivityDays } from './model.ts';

export const activityEndpoint = new Elysia().get('/dashboard/activity', ({ query }) => {
  return handleDashboardActivity(normalizeActivityDays(query.days));
}, {
  query: ActivityQuery,
  detail: {
    tags: ['dashboard'],
    menu: { group: 'hidden' },
    summary: 'Activity counts over N days',
  },
});
