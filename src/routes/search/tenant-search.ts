import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import type { SearchResponse } from '../../server/types.ts';

function normalizeRank(rank: number): number {
  return Math.min(1, Math.max(0, 1 / (1 + Math.abs(rank))));
}

export function handleTenantSearch(
  query: string,
  type = 'all',
  limit = 10,
  offset = 0,
): SearchResponse & { mode: string; warning?: string; vectorAvailable: boolean } | null {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const safeQuery = query
    .replace(/<[^>]*>/g, ' ')
    .replace(/[?*+\-()^~"':;<>{}[\]\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!safeQuery) return { results: [], total: 0, limit, offset, query, mode: 'fts', vectorAvailable: false };

  const typeClause = type === 'all' ? '' : 'AND d.type = ?';
  const params = type === 'all' ? [safeQuery, tenantId] : [safeQuery, type, tenantId];
  const count = sqlite.prepare(`
    SELECT COUNT(*) as total
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? ${typeClause} AND d.tenant_id = ?
  `).get(...params) as { total: number };
  const rows = sqlite.prepare(`
    SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, rank as score
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? ${typeClause} AND d.tenant_id = ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<Record<string, any>>;

  return {
    results: rows.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      source_file: row.source_file,
      concepts: JSON.parse(row.concepts || '[]'),
      project: row.project,
      source: 'fts' as const,
      score: normalizeRank(row.score),
    })),
    total: count.total,
    offset,
    limit,
    query,
    mode: 'fts',
    vectorAvailable: false,
    warning: 'Tenant-scoped HTTP search uses SQLite/FTS isolation for this request',
  };
}
