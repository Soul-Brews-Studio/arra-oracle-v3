import { Elysia } from 'elysia';
import { SummaryParams, SummaryBody, MAX_SUMMARY_CHARS } from './model.ts';
import { persistSessionSummary } from './store.ts';

function persistenceError(error: unknown): { status: 400 | 409 | 500; body: { error: string } } {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Invalid session id') return { status: 400, body: { error: 'Invalid session id' } };
  if (message === 'Invalid summary') return { status: 400, body: { error: 'Missing required field: summary' } };
  if (message === 'Summary too long') {
    return { status: 400, body: { error: `summary exceeds max length (${MAX_SUMMARY_CHARS} chars)` } };
  }
  if (message.startsWith('File already exists:')) {
    return { status: 409, body: { error: 'Session summary already exists' } };
  }
  return { status: 500, body: { error: 'Could not persist session summary' } };
}

export const summaryRoute = new Elysia().post(
  '/api/session/:id/summary',
  ({ params, body, set }) => {
    const summary = body.summary.trim();
    if (summary.trim().length === 0) {
      set.status = 400;
      return { error: 'Missing required field: summary' };
    }
    if (summary.length > MAX_SUMMARY_CHARS) {
      set.status = 400;
      return { error: `summary exceeds max length (${MAX_SUMMARY_CHARS} chars)` };
    }
    try {
      set.status = 201;
      return persistSessionSummary(params.id, summary, body.oracle);
    } catch (error) {
      const response = persistenceError(error);
      set.status = response.status;
      return response.body;
    }
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
