import { Elysia } from 'elysia';
import { desc } from 'drizzle-orm';
import { db, searchLog } from '../../db/index.ts';
import { logsQuery } from './model.ts';

export const logsRoute = new Elysia().get(
  '/api/logs',
  ({ query }) => {
    try {
      const limit = parseInt(query.limit || '20');
      const logs = db
        .select({
          id: searchLog.id,
          query: searchLog.query,
          type: searchLog.type,
          mode: searchLog.mode,
          results_count: searchLog.resultsCount,
          search_time_ms: searchLog.searchTimeMs,
          created_at: searchLog.createdAt,
          project: searchLog.project,
          results: searchLog.results,
        })
        .from(searchLog)
        .orderBy(desc(searchLog.createdAt))
        .limit(limit)
        .all();
      return { logs, total: logs.length };
    } catch {
      return { logs: [], error: 'Log table not found' };
    }
  },
  {
    query: logsQuery,
    detail: {
      tags: ['files'],
      menu: { group: 'hidden' },
      summary: 'Recent search log entries',
    },
  },
);
