import { Elysia } from 'elysia';
import { SummaryParams, SummaryBody, MAX_SUMMARY_CHARS } from './model.ts';
import { persistSessionSummary } from './store.ts';

export const summaryRoute = new Elysia().post(
  '/api/session/:id/summary',
  ({ params, body, set }) => {
    const summary = body.summary;
    if (summary.trim().length === 0) {
      set.status = 400;
      return { error: 'Missing required field: summary' };
    }
    if (summary.length > MAX_SUMMARY_CHARS) {
      set.status = 400;
      return { error: `summary exceeds max length (${MAX_SUMMARY_CHARS} chars)` };
    }
    set.status = 201;
    return persistSessionSummary(params.id, summary, body.oracle);
  },
  {
    params: SummaryParams,
    body: SummaryBody,
    detail: {
      tags: ['sessions'],
      menu: { group: 'hidden' },
      summary: 'Record a session summary',
    },
  },
);
