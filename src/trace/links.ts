import { eq } from 'drizzle-orm';
import { db, traceLog } from '../db/index.ts';
import type { TraceRecord } from './types.ts';
import { getTrace } from './store.ts';

type LinkResult = {
  success: boolean;
  message: string;
  prevTrace?: TraceRecord;
  nextTrace?: TraceRecord;
};

function hasForwardPath(fromTraceId: string, toTraceId: string): boolean {
  const seen = new Set<string>();
  let current: TraceRecord | null = getTrace(fromTraceId);
  while (current && !seen.has(current.traceId)) {
    if (current.traceId === toTraceId) return true;
    seen.add(current.traceId);
    current = current.nextTraceId ? getTrace(current.nextTraceId) : null;
  }
  return false;
}

export function linkTraces(prevTraceId: string, nextTraceId: string): LinkResult {
  if (!prevTraceId || typeof prevTraceId !== 'string') {
    return { success: false, message: `prevTraceId is required (got: ${prevTraceId === undefined ? 'undefined' : typeof prevTraceId})` };
  }
  if (!nextTraceId || typeof nextTraceId !== 'string') {
    return { success: false, message: `nextTraceId is required (got: ${nextTraceId === undefined ? 'undefined' : typeof nextTraceId})` };
  }
  if (prevTraceId === nextTraceId) return { success: false, message: `Cannot link a trace to itself: ${prevTraceId}` };

  const prevTrace = getTrace(prevTraceId);
  const nextTrace = getTrace(nextTraceId);
  if (!prevTrace) return { success: false, message: `Previous trace not found: ${prevTraceId}` };
  if (!nextTrace) return { success: false, message: `Next trace not found: ${nextTraceId}` };
  if (prevTrace.nextTraceId) return { success: false, message: `Trace ${prevTraceId} already has a next link` };
  if (nextTrace.prevTraceId) return { success: false, message: `Trace ${nextTraceId} already has a prev link` };
  if (hasForwardPath(nextTraceId, prevTraceId)) return { success: false, message: `Cannot link ${prevTraceId} → ${nextTraceId}: it would create a cycle` };

  const now = Date.now();
  db.update(traceLog).set({ nextTraceId, updatedAt: now }).where(eq(traceLog.traceId, prevTraceId)).run();
  db.update(traceLog).set({ prevTraceId, updatedAt: now }).where(eq(traceLog.traceId, nextTraceId)).run();

  return {
    success: true,
    message: `Linked: ${prevTraceId} → ${nextTraceId}`,
    prevTrace: getTrace(prevTraceId) || undefined,
    nextTrace: getTrace(nextTraceId) || undefined,
  };
}

export function unlinkTraces(traceId: string, direction: 'prev' | 'next'): { success: boolean; message: string } {
  const trace = getTrace(traceId);
  if (!trace) return { success: false, message: `Trace not found: ${traceId}` };

  const now = Date.now();
  if (direction === 'next' && trace.nextTraceId) {
    db.update(traceLog).set({ nextTraceId: null, updatedAt: now }).where(eq(traceLog.traceId, traceId)).run();
    db.update(traceLog).set({ prevTraceId: null, updatedAt: now }).where(eq(traceLog.traceId, trace.nextTraceId)).run();
    return { success: true, message: `Unlinked next: ${traceId} -/-> ${trace.nextTraceId}` };
  }
  if (direction === 'prev' && trace.prevTraceId) {
    db.update(traceLog).set({ prevTraceId: null, updatedAt: now }).where(eq(traceLog.traceId, traceId)).run();
    db.update(traceLog).set({ nextTraceId: null, updatedAt: now }).where(eq(traceLog.traceId, trace.prevTraceId)).run();
    return { success: true, message: `Unlinked prev: ${trace.prevTraceId} -/-> ${traceId}` };
  }
  return { success: false, message: `No ${direction} link to remove` };
}
