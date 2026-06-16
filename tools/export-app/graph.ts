import type { ExportRecord } from './formats.ts';

export type GraphRelationship = {
  type: string;
  from: string;
  to: string;
  metadata?: Record<string, unknown>;
};

export function graphRelationships(collections: Record<string, ExportRecord[]>): GraphRelationship[] {
  return [
    ...documentRelationships(collections.oracle_documents ?? []),
    ...supersedeRelationships(collections.supersede_log ?? []),
    ...traceRelationships(collections.trace_log ?? []),
  ];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function documentRelationships(rows: ExportRecord[]): GraphRelationship[] {
  return rows.flatMap((row) => {
    const from = text(row.id);
    const to = text(row.supersededBy);
    if (!from || !to) return [];
    return [{ type: 'document_superseded_by', from, to, metadata: { reason: row.supersededReason, at: row.supersededAt } }];
  });
}

function supersedeRelationships(rows: ExportRecord[]): GraphRelationship[] {
  return rows.flatMap((row) => {
    const from = text(row.oldId) ?? text(row.oldPath);
    const to = text(row.newId) ?? text(row.newPath) ?? text(row.supersededBy);
    if (!from || !to) return [];
    return [{
      type: 'supersede_log',
      from,
      to,
      metadata: {
        oldPath: row.oldPath,
        newPath: row.newPath,
        reason: row.reason,
        at: row.supersededAt,
        by: row.supersededBy,
        project: row.project,
      },
    }];
  });
}

function traceRelationships(rows: ExportRecord[]): GraphRelationship[] {
  const out: GraphRelationship[] = [];
  for (const row of rows) {
    const traceId = text(row.traceId);
    if (!traceId) continue;
    const parent = text(row.parentTraceId);
    const prev = text(row.prevTraceId);
    const next = text(row.nextTraceId);
    if (parent) out.push({ type: 'trace_parent', from: traceId, to: parent });
    if (prev) out.push({ type: 'trace_prev', from: traceId, to: prev });
    if (next) out.push({ type: 'trace_next', from: traceId, to: next });
    for (const child of childTraceIds(row.childTraceIds)) out.push({ type: 'trace_child', from: traceId, to: child });
  }
  return out;
}

function childTraceIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
