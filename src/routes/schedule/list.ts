import { Elysia } from 'elysia';
import { REPO_ROOT } from '../../config.ts';
import { db, sqlite } from '../../db/index.ts';
import { handleScheduleList } from '../../tools/schedule.ts';
import type { ToolContext } from '../../tools/types.ts';
import { listQuery } from './model.ts';

export const scheduleListRoute = new Elysia().get('/api/schedule', async ({ query }) => {
  const ctx = { db, sqlite, repoRoot: REPO_ROOT } as Pick<ToolContext, 'db' | 'sqlite' | 'repoRoot'>;
  const result = await handleScheduleList(ctx as ToolContext, {
    date: query.date,
    from: query.from,
    to: query.to,
    filter: query.filter,
    status: query.status as 'pending' | 'done' | 'cancelled' | 'all' | undefined,
    limit: query.limit ? parseInt(query.limit) : undefined,
  });
  const text = result.content[0]?.text || '{}';
  return JSON.parse(text);
}, {
  query: listQuery,
  detail: {
    tags: ['schedule'],
    menu: { group: 'main', path: '/schedule', order: 60 },
    summary: 'List scheduled events',
  },
});
