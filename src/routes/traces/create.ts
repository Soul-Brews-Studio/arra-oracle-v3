import { Elysia } from 'elysia';

import { createTrace } from '../../trace/handler.ts';
import { traceCreateBody } from './model.ts';
import type { CreateTraceInput } from '../../trace/types.ts';

export const traceCreateRoute = new Elysia().post('/api/traces', ({ body, set }) => {
  const input = body as Partial<CreateTraceInput> | null | undefined;
  if (!input || typeof input.query !== 'string' || input.query.trim().length === 0) {
    set.status = 400;
    return {
      success: false,
      error: "oracle_trace requires field 'query' (non-empty string).",
      usage: "POST /api/traces { query: 'what was traced', scope?: 'project'|'cross-project'|'human' }",
    };
  }

  const result = createTrace(input as CreateTraceInput);
  set.status = 201;
  return {
    success: result.success,
    trace_id: result.traceId,
    depth: result.depth,
    summary: {
      file_count: result.summary.fileCount,
      commit_count: result.summary.commitCount,
      issue_count: result.summary.issueCount,
      total_dig_points: result.summary.totalDigPoints,
    },
    message: `Trace logged. Use oracle_trace_get with trace_id="${result.traceId}" to explore dig points.`,
  };
}, {
  body: traceCreateBody,
  detail: {
    tags: ['traces'],
    menu: { group: 'hidden' },
    summary: 'Create a trace log entry',
  },
});
