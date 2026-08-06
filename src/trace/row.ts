import type { TraceRecord, TraceSummary } from './types.ts';
import { traceLog } from '../db/index.ts';

type TraceRow = typeof traceLog.$inferSelect;

export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function serializeJsonArray<T>(value: T[] | undefined): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

export function parseTraceRow(row: TraceRow): TraceRecord {
  return {
    id: row.id,
    traceId: row.traceId,
    query: row.query,
    queryType: row.queryType || 'general',
    foundFiles: parseJsonArray(row.foundFiles),
    foundCommits: parseJsonArray(row.foundCommits),
    foundIssues: parseJsonArray(row.foundIssues),
    foundRetrospectives: parseJsonArray(row.foundRetrospectives),
    foundLearnings: parseJsonArray(row.foundLearnings),
    foundResonance: parseJsonArray(row.foundResonance),
    fileCount: row.fileCount || 0,
    commitCount: row.commitCount || 0,
    issueCount: row.issueCount || 0,
    depth: row.depth || 0,
    parentTraceId: row.parentTraceId,
    childTraceIds: parseJsonArray<string>(row.childTraceIds),
    prevTraceId: row.prevTraceId,
    nextTraceId: row.nextTraceId,
    scope: row.scope || 'project',
    project: row.project,
    sessionId: row.sessionId,
    agentCount: row.agentCount || 1,
    durationMs: row.durationMs,
    status: row.status || 'raw',
    awakening: row.awakening,
    distilledToId: row.distilledToId,
    distilledAt: row.distilledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTraceSummary(trace: TraceRecord): TraceSummary {
  return {
    traceId: trace.traceId,
    query: trace.query,
    scope: trace.scope,
    depth: trace.depth,
    fileCount: trace.fileCount,
    commitCount: trace.commitCount,
    issueCount: trace.issueCount,
    status: trace.status,
    hasAwakening: !!trace.awakening,
    createdAt: trace.createdAt,
  };
}
