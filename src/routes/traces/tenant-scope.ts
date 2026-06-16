import { and, desc, eq, like, sql, type SQL } from 'drizzle-orm';
import { db, traceLog } from '../../db/index.ts';
import { activeTenantId, tenantIdForWrite } from '../../middleware/tenant.ts';
import { createTrace, getTrace } from '../../trace/handler.ts';
import type { CreateTraceInput, CreateTraceResult, ListTracesInput, ListTracesResult, TraceChainResult, TraceRecord, TraceSummary } from '../../trace/types.ts';

function tenantTraceWhere(traceId: string): SQL {
  return and(eq(traceLog.traceId, traceId), eq(traceLog.tenantId, activeTenantId())) as SQL;
}

export function getTenantTrace(traceId: string): TraceRecord | null {
  const row = db.select({ traceId: traceLog.traceId }).from(traceLog).where(tenantTraceWhere(traceId)).get();
  return row ? getTrace(traceId) : null;
}

function hasTenantForwardPath(fromTraceId: string, toTraceId: string): boolean {
  const seen = new Set<string>();
  let current = getTenantTrace(fromTraceId);
  while (current && !seen.has(current.traceId)) {
    if (current.traceId === toTraceId) return true;
    seen.add(current.traceId);
    current = current.nextTraceId ? getTenantTrace(current.nextTraceId) : null;
  }
  return false;
}

export function createTenantTrace(input: CreateTraceInput): CreateTraceResult {
  if (input.parentTraceId && !getTenantTrace(input.parentTraceId)) throw new Error(`Parent trace not found: ${input.parentTraceId}`);
  const result = createTrace(input);
  db.update(traceLog).set({ tenantId: tenantIdForWrite() }).where(eq(traceLog.traceId, result.traceId)).run();
  return result;
}

export function listTenantTraces(input: ListTracesInput): ListTracesResult {
  const limit = Math.min(100, Math.max(1, Number.isFinite(input.limit) ? input.limit! : 20));
  const offset = Math.max(0, Number.isFinite(input.offset) ? input.offset! : 0);
  const conditions = [eq(traceLog.tenantId, activeTenantId())];
  if (input.query) conditions.push(like(traceLog.query, `%${input.query}%`));
  if (input.project) conditions.push(eq(traceLog.project, input.project));
  if (input.status) conditions.push(eq(traceLog.status, input.status));
  if (input.depth !== undefined) conditions.push(eq(traceLog.depth, input.depth));
  const whereClause = and(...conditions);
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
    createdAt: traceLog.createdAt,
  }).from(traceLog).where(whereClause).orderBy(desc(traceLog.createdAt)).limit(limit).offset(offset).all();
  const total = countResult?.count || 0;
  return {
    traces: rows.map((row) => ({
      traceId: row.traceId,
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

export function getTenantTraceChain(traceId: string, direction: 'up' | 'down' | 'both' = 'both'): TraceChainResult {
  const chain: TraceSummary[] = [];
  const added = new Set<string>();
  let hasAwakening = false;
  let awakeningTraceId: string | undefined;
  const addTrace = (trace: TraceRecord, prepend = false) => {
    if (added.has(trace.traceId)) return;
    added.add(trace.traceId);
    if (prepend) chain.unshift(toSummary(trace));
    else chain.push(toSummary(trace));
    if (trace.awakening) {
      hasAwakening = true;
      awakeningTraceId = trace.traceId;
    }
  };
  if (direction === 'up' || direction === 'both') {
    let current = getTenantTrace(traceId);
    const visited = new Set<string>();
    while (current?.parentTraceId) {
      if (visited.has(current.parentTraceId)) break;
      visited.add(current.parentTraceId);
      const parent = getTenantTrace(current.parentTraceId);
      if (parent) addTrace(parent, true);
      current = parent;
    }
  }
  const self = getTenantTrace(traceId);
  if (self) addTrace(self);
  if (direction === 'down' || direction === 'both') {
    const queue = self?.childTraceIds || [];
    const visited = new Set<string>(self ? [self.traceId] : []);
    while (queue.length > 0) {
      const childId = queue.shift()!;
      if (visited.has(childId)) continue;
      visited.add(childId);
      const child = getTenantTrace(childId);
      if (child) {
        addTrace(child);
        queue.push(...child.childTraceIds);
      }
    }
  }
  return { chain, totalDepth: Math.max(...chain.map((trace) => trace.depth), 0), hasAwakening, awakeningTraceId };
}

export function linkTenantTraces(prevTraceId: string, nextTraceId: string) {
  if (!prevTraceId) return { success: false, message: 'prevTraceId is required' };
  if (!nextTraceId) return { success: false, message: 'nextTraceId is required' };
  if (prevTraceId === nextTraceId) return { success: false, message: `Cannot link a trace to itself: ${prevTraceId}` };
  const prevTrace = getTenantTrace(prevTraceId);
  const nextTrace = getTenantTrace(nextTraceId);
  if (!prevTrace) return { success: false, message: `Previous trace not found: ${prevTraceId}` };
  if (!nextTrace) return { success: false, message: `Next trace not found: ${nextTraceId}` };
  if (prevTrace.nextTraceId) return { success: false, message: `Trace ${prevTraceId} already has a next link` };
  if (nextTrace.prevTraceId) return { success: false, message: `Trace ${nextTraceId} already has a prev link` };
  if (hasTenantForwardPath(nextTraceId, prevTraceId)) return { success: false, message: `Cannot link ${prevTraceId} → ${nextTraceId}: it would create a cycle` };
  const now = Date.now();
  db.update(traceLog).set({ nextTraceId, updatedAt: now }).where(tenantTraceWhere(prevTraceId)).run();
  db.update(traceLog).set({ prevTraceId, updatedAt: now }).where(tenantTraceWhere(nextTraceId)).run();
  return { success: true, message: `Linked: ${prevTraceId} → ${nextTraceId}`, prevTrace: getTenantTrace(prevTraceId), nextTrace: getTenantTrace(nextTraceId) };
}

export function unlinkTenantTraces(traceId: string, direction: 'prev' | 'next') {
  const trace = getTenantTrace(traceId);
  if (!trace) return { success: false, message: `Trace not found: ${traceId}` };
  const linkedId = direction === 'next' ? trace.nextTraceId : trace.prevTraceId;
  if (!linkedId) return { success: false, message: `No ${direction} link to remove` };
  const now = Date.now();
  db.update(traceLog).set({ [direction === 'next' ? 'nextTraceId' : 'prevTraceId']: null, updatedAt: now }).where(tenantTraceWhere(traceId)).run();
  const linkedPatch = direction === 'next' ? { prevTraceId: null, updatedAt: now } : { nextTraceId: null, updatedAt: now };
  if (getTenantTrace(linkedId)) db.update(traceLog).set(linkedPatch).where(tenantTraceWhere(linkedId)).run();
  return { success: true, message: `Unlinked ${direction}: ${traceId} -/-> ${linkedId}` };
}

export function getTenantTraceLinkedChain(traceId: string): { chain: TraceRecord[]; position: number } {
  const chain: TraceRecord[] = [];
  let position = 0;
  let current = getTenantTrace(traceId);
  const backwardVisited = new Set<string>();
  while (current?.prevTraceId && !backwardVisited.has(current.prevTraceId)) {
    backwardVisited.add(current.traceId);
    current = getTenantTrace(current.prevTraceId);
  }
  const forwardVisited = new Set<string>();
  while (current && !forwardVisited.has(current.traceId)) {
    if (current.traceId === traceId) position = chain.length;
    chain.push(current);
    forwardVisited.add(current.traceId);
    current = current.nextTraceId ? getTenantTrace(current.nextTraceId) : null;
  }
  return { chain, position };
}

function toSummary(trace: TraceRecord): TraceSummary {
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
