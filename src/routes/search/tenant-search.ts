import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import type { SearchResponse } from '../../server/types.ts';

type SearchRouteResponse = SearchResponse & { mode: string; warning?: string; vectorAvailable: boolean };
type ListRow = Record<string, any>;
const FTS_TOKEN_LIMIT = 8;

function normalizeRank(rank: number): number {
  return Math.min(1, Math.max(0, 1 / (1 + Math.abs(rank))));
}

function parseConcepts(value: string | null | undefined): string[] {
  try { return JSON.parse(value || '[]') as string[]; } catch { return []; }
}

function buildTenantFtsQuery(query: string): string {
  const tokens = query
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((token) => token.trim())
    .filter(Boolean)
    .slice(0, FTS_TOKEN_LIMIT) ?? [];

  return Array.from(new Set(tokens))
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function runFtsGet<T>(stmt: { get: (...args: any[]) => T }, args: unknown[]): T | null {
  try { return stmt.get(...args); } catch { return null; }
}

function runFtsAll<T>(stmt: { all: (...args: any[]) => T[] }, args: unknown[]): T[] {
  try { return stmt.all(...args); } catch { return []; }
}

export function handleTenantSearch(query: string, type = 'all', limit = 10, offset = 0): SearchRouteResponse | null {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const safeQuery = buildTenantFtsQuery(query);
  if (!safeQuery) return { results: [], total: 0, limit, offset, query, mode: 'fts', vectorAvailable: false };

  const typeClause = type === 'all' ? '' : 'AND d.type = ?';
  const params = type === 'all' ? [safeQuery, tenantId] : [safeQuery, type, tenantId];
  const count = runFtsGet(sqlite.prepare(`
    SELECT COUNT(*) as total
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? ${typeClause} AND d.tenant_id = ?
  `), params) as { total: number } | null;
  const rows = runFtsAll(sqlite.prepare(`
    SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, rank as score
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? ${typeClause} AND d.tenant_id = ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `), [...params, limit, offset]) as ListRow[];

  return {
    results: rows.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      source_file: row.source_file,
      concepts: parseConcepts(row.concepts),
      project: row.project,
      source: 'fts' as const,
      score: normalizeRank(row.score),
    })),
    total: count?.total ?? 0,
    offset,
    limit,
    query,
    mode: 'fts',
    vectorAvailable: false,
    warning: 'Tenant-scoped HTTP search uses SQLite/FTS isolation for this request',
  };
}

export function handleTenantList(type = 'all', limit = 10, offset = 0, groupByFile = true): SearchResponse | null {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const typeClause = type === 'all' ? '' : 'AND d.type = ?';
  const params = type === 'all' ? [tenantId] : [type, tenantId];
  const countExpr = groupByFile ? 'count(distinct d.source_file)' : 'count(*)';
  const count = sqlite.prepare(`
    SELECT ${countExpr} as total
    FROM oracle_documents d
    WHERE 1=1 ${typeClause} AND d.tenant_id = ?
  `).get(...params) as { total: number };

  const indexedAt = groupByFile ? 'MAX(d.indexed_at)' : 'd.indexed_at';
  const groupSql = groupByFile ? 'GROUP BY d.source_file' : '';
  const rows = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, d.project, ${indexedAt} as indexed_at, f.content
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    WHERE 1=1 ${typeClause} AND d.tenant_id = ?
    ${groupSql}
    ORDER BY indexed_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as ListRow[];

  return {
    results: rows.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content || '',
      source_file: row.source_file,
      concepts: parseConcepts(row.concepts),
      project: row.project,
      indexed_at: row.indexed_at,
    })),
    total: count.total,
    offset,
    limit,
  };
}

export function handleTenantReflect(): Record<string, unknown> | null {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const row = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, f.content
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    WHERE d.tenant_id = ? AND d.type IN ('principle', 'learning')
    ORDER BY RANDOM()
    LIMIT 1
  `).get(tenantId) as ListRow | undefined;

  if (!row) return { error: 'No documents found' };
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    source_file: row.source_file,
    concepts: parseConcepts(row.concepts),
  };
}
