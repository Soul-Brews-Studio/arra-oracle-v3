import { and, desc, eq, like, sql } from 'drizzle-orm';
import { db, traceLog } from '../db/index.ts';
import type { ListTracesInput, ListTracesResult } from './types.ts';

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value!);
  return Math.min(max, Math.max(min, integer));
}

export function listTraces(input: ListTracesInput = {}): ListTracesResult {
  const limit = boundedInteger(input.limit, 20, 1, 100);
  const offset = boundedInteger(input.offset, 0, 0, 10_000);
  const conditions = [];

  if (input.query) conditions.push(like(traceLog.query, `%${input.query}%`));
  if (input.project) conditions.push(eq(traceLog.project, input.project));
  if (input.status) conditions.push(eq(traceLog.status, input.status));
  if (input.depth !== undefined) conditions.push(eq(traceLog.depth, input.depth));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const countResult = db.select({ count: sql<number>`count(*)` }).from(traceLog).where(whereClause).get();
  const rows = db.select({
    traceId: traceLog.traceId,
    query: traceLog.query,
    depth: traceLog.depth,
    fileCount: traceLog.fileCount,
    commitCount: traceLog.commitCount,
    issueCount: traceLog.issueCount,
    scope: traceLog.scope,
    status: traceLog.status,
    awakening: traceLog.awakening,
    parentTraceId: traceLog.parentTraceId,
    prevTraceId: traceLog.prevTraceId,
    nextTraceId: traceLog.nextTraceId,
    createdAt: traceLog.createdAt,
  }).from(traceLog).where(whereClause).orderBy(desc(traceLog.createdAt)).limit(limit).offset(offset).all();
  const total = countResult?.count || 0;

  return {
    traces: rows.map((row) => ({
      traceId: row.traceId,
      parentTraceId: row.parentTraceId,
      prevTraceId: row.prevTraceId,
      nextTraceId: row.nextTraceId,
      query: row.query,
      scope: row.scope || 'project',
      depth: row.depth || 0,
      fileCount: row.fileCount || 0,
      commitCount: row.commitCount || 0,
      issueCount: row.issueCount || 0,
      status: row.status || 'raw',
      hasAwakening: !!row.awakening,
      createdAt: row.createdAt,
    })),
    total,
    hasMore: offset + rows.length < total,
  };
}
