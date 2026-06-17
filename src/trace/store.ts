import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, traceLog } from '../db/index.ts';
import type { CreateTraceInput, CreateTraceResult, TraceRecord } from './types.ts';
import { processLearnings } from './learning-files.ts';
import { parseJsonArray, parseTraceRow, serializeJsonArray } from './row.ts';

function normalizedQuery(input: CreateTraceInput): string {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) throw new Error('Trace query is required');
  return query;
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function createTrace(input: CreateTraceInput): CreateTraceResult {
  const traceId = randomUUID();
  const now = Date.now();
  const query = normalizedQuery(input);
  const processedLearnings = processLearnings(input.foundLearnings, input.project || null, query);
  const fileCount =
    arrayCount(input.foundFiles) +
    arrayCount(input.foundRetrospectives) +
    processedLearnings.length +
    arrayCount(input.foundResonance);
  const commitCount = arrayCount(input.foundCommits);
  const issueCount = arrayCount(input.foundIssues);

  const parent = input.parentTraceId ? db
    .select({ depth: traceLog.depth })
    .from(traceLog)
    .where(eq(traceLog.traceId, input.parentTraceId))
    .get() : null;
  const depth = parent ? (parent.depth || 0) + 1 : 0;

  db.insert(traceLog).values({
    traceId,
    query,
    queryType: input.queryType || 'general',
    foundFiles: serializeJsonArray(input.foundFiles),
    foundCommits: serializeJsonArray(input.foundCommits),
    foundIssues: serializeJsonArray(input.foundIssues),
    foundRetrospectives: serializeJsonArray(input.foundRetrospectives),
    foundLearnings: serializeJsonArray(processedLearnings),
    foundResonance: serializeJsonArray(input.foundResonance),
    fileCount,
    commitCount,
    issueCount,
    depth,
    parentTraceId: parent ? input.parentTraceId! : null,
    childTraceIds: '[]',
    scope: input.scope || 'project',
    project: input.project || null,
    sessionId: input.sessionId || null,
    agentCount: input.agentCount || 1,
    durationMs: input.durationMs || null,
    status: 'raw',
    createdAt: now,
    updatedAt: now,
  }).run();

  if (parent && input.parentTraceId) updateTraceChildren(input.parentTraceId, traceId);
  return { success: true, traceId, depth, summary: { fileCount, commitCount, issueCount, totalDigPoints: fileCount + commitCount + issueCount } };
}

export function getTrace(traceId: string): TraceRecord | null {
  const row = db.select().from(traceLog).where(eq(traceLog.traceId, traceId)).get();
  return row ? parseTraceRow(row) : null;
}

function updateTraceChildren(parentId: string, childId: string): void {
  const parent = db
    .select({ childTraceIds: traceLog.childTraceIds })
    .from(traceLog)
    .where(eq(traceLog.traceId, parentId))
    .get();
  if (!parent) return;

  const children = parseJsonArray<string>(parent.childTraceIds);
  if (!children.includes(childId)) children.push(childId);
  db.update(traceLog)
    .set({ childTraceIds: JSON.stringify(children), updatedAt: Date.now() })
    .where(eq(traceLog.traceId, parentId))
    .run();
}
