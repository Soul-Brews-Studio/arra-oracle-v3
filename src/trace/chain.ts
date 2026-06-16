import type { TraceChainResult, TraceRecord, TraceSummary } from './types.ts';
import { getTrace } from './store.ts';
import { toTraceSummary } from './row.ts';

function addSummary(
  trace: TraceRecord,
  chain: TraceSummary[],
  seen: Set<string>,
  prepend = false,
): string | undefined {
  if (seen.has(trace.traceId)) return undefined;
  seen.add(trace.traceId);
  if (prepend) chain.unshift(toTraceSummary(trace));
  else chain.push(toTraceSummary(trace));
  return trace.awakening ? trace.traceId : undefined;
}

export function getTraceChain(
  traceId: string,
  direction: 'up' | 'down' | 'both' = 'both',
): TraceChainResult {
  const chain: TraceSummary[] = [];
  const seen = new Set<string>();
  let awakeningTraceId: string | undefined;

  if (direction === 'up' || direction === 'both') {
    let current = getTrace(traceId);
    const parents = new Set<string>();
    while (current?.parentTraceId && !parents.has(current.parentTraceId)) {
      parents.add(current.parentTraceId);
      const parent = getTrace(current.parentTraceId);
      if (!parent) break;
      awakeningTraceId = addSummary(parent, chain, seen, true) ?? awakeningTraceId;
      current = parent;
    }
  }

  const self = getTrace(traceId);
  if (self) awakeningTraceId = addSummary(self, chain, seen) ?? awakeningTraceId;

  if (self && (direction === 'down' || direction === 'both')) {
    const queue = [...self.childTraceIds];
    const descendants = new Set<string>([self.traceId]);
    while (queue.length > 0) {
      const childId = queue.shift()!;
      if (descendants.has(childId)) continue;
      descendants.add(childId);
      const child = getTrace(childId);
      if (!child) continue;
      awakeningTraceId = addSummary(child, chain, seen) ?? awakeningTraceId;
      queue.push(...child.childTraceIds);
    }
  }

  return {
    chain,
    totalDepth: Math.max(...chain.map((trace) => trace.depth), 0),
    hasAwakening: Boolean(awakeningTraceId),
    awakeningTraceId,
  };
}

export function getTraceLinkedChain(traceId: string): { chain: TraceRecord[]; position: number } {
  if (!traceId || typeof traceId !== 'string') return { chain: [], position: 0 };
  const chain: TraceRecord[] = [];
  let position = 0;
  let current = getTrace(traceId);
  const backwardVisited = new Set<string>();

  while (current?.prevTraceId && !backwardVisited.has(current.prevTraceId)) {
    backwardVisited.add(current.traceId);
    current = getTrace(current.prevTraceId);
  }

  const forwardVisited = new Set<string>();
  while (current && !forwardVisited.has(current.traceId)) {
    if (current.traceId === traceId) position = chain.length;
    chain.push(current);
    forwardVisited.add(current.traceId);
    current = current.nextTraceId ? getTrace(current.nextTraceId) : null;
  }
  return { chain, position };
}
