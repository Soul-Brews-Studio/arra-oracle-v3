import { currentTenantId } from '../../middleware/tenant.ts';
import type { ToolContext } from '../types.ts';
import { normalizeFtsScore } from './helpers.ts';
import type { CombinedSearchResult, FtsResult, FtsRow } from './types.ts';

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
  if (results.length === 0) return;
  const tenantId = currentTenantId();
  const ids = results.map((result) => result.id as string);
  const placeholders = ids.map(() => '?').join(',');
  const tenantFilter = tenantId ? 'AND tenant_id = ?' : '';
  const supersedeRows = ctx.sqlite.prepare(`
    SELECT id, superseded_by, superseded_at, superseded_reason
    FROM oracle_documents
    WHERE id IN (${placeholders}) AND superseded_by IS NOT NULL ${tenantFilter}
  `).all(...ids, ...(tenantId ? [tenantId] : [])) as Array<{
    id: string;
    superseded_by: string;
    superseded_at: number;
    superseded_reason: string | null;
  }>;
  const supersedeMap = new Map(supersedeRows.map((row) => [row.id, row]));

  for (const result of results as CombinedSearchResult[]) {
    const supersede = supersedeMap.get(result.id);
    if (!supersede) continue;
    const writable = result as unknown as Record<string, unknown>;
    writable.superseded_by = supersede.superseded_by;
    writable.superseded_at = new Date(supersede.superseded_at).toISOString();
    writable.superseded_reason = supersede.superseded_reason;
  }
}
