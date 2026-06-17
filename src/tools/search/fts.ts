import { currentTenantId } from '../../middleware/tenant.ts';
import { attachSupersedeStatus } from '../../search/supersede-status.ts';
import type { ToolContext } from '../types.ts';
import { normalizeFtsScore } from './helpers.ts';
import type { FtsResult, FtsRow } from './types.ts';

function parseConcepts(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function searchFts(
  ctx: ToolContext,
  safeQuery: string,
  type: string,
  limit: number,
  project: string | null,
): FtsRow[] {
  const tenantId = currentTenantId();
  const projectFilter = project ? 'AND (d.project = ? OR d.project IS NULL)' : '';
  const tenantFilter = tenantId ? 'AND d.tenant_id = ?' : '';
  const typeFilter = type === 'all' ? '' : 'AND d.type = ?';
  const params = [
    safeQuery,
    ...(type === 'all' ? [] : [type]),
    ...(project ? [project] : []),
    ...(tenantId ? [tenantId] : []),
    limit,
  ];

  return ctx.sqlite.prepare(`
    SELECT f.id, f.content, d.type, d.source_file, d.concepts, rank
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? ${typeFilter} ${projectFilter} ${tenantFilter}
    ORDER BY rank
    LIMIT ?
  `).all(...params) as FtsRow[];
}

export function mapFtsResults(rows: FtsRow[]): FtsResult[] {
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    content: row.content.substring(0, 500),
    source_file: row.source_file,
    concepts: parseConcepts(row.concepts),
    score: normalizeFtsScore(row.rank),
    source: 'fts' as const,
  }));
}

export function enrichSupersedeFlags(ctx: ToolContext, results: Array<Record<string, unknown>>): void {
  attachSupersedeStatus(ctx.sqlite, results);
}
