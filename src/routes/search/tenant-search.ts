import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { BI_TEMPORAL_JOIN, BI_TEMPORAL_WHERE, biTemporalParams } from '../../search/bitemporal.ts';
import { logDocumentAccess } from '../../server/logging.ts';
import type { SearchResponse } from '../../server/types.ts';
import { buildTenantFtsQuery, parseConcepts } from '../../search/query.ts';

type SearchRouteResponse = SearchResponse & { mode: string; warning?: string; vectorAvailable: boolean };
type ListRow = Record<string, any>;
function normalizeRank(rank: number): number {
  return Math.min(1, Math.max(0, 1 / (1 + Math.abs(rank))));
}

function runFtsGet<T>(stmt: { get: (...args: any[]) => T }, args: unknown[]): T | null {
  try { return stmt.get(...args); } catch { return null; }
}

function runFtsAll<T>(stmt: { all: (...args: any[]) => T[] }, args: unknown[]): T[] {
  try { return stmt.all(...args); } catch { return []; }
}

export function handleTenantSearch(query: string, type = 'all', limit = 10, offset = 0, asOfMs?: number): SearchRouteResponse | null {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const safeQuery = buildTenantFtsQuery(query);
  if (!safeQuery) return { results: [], total: 0, limit, offset, query, mode: 'fts', vectorAvailable: false };

  const typeClause = type === 'all' ? '' : 'AND d.type = ?';
  const temporalJoin = asOfMs ? BI_TEMPORAL_JOIN : '';
  const temporalClause = asOfMs ? `AND ${BI_TEMPORAL_WHERE}` : '';
  const temporalSelect = asOfMs ? ', d.valid_time, COALESCE(s.valid_time, d.superseded_at) as valid_until' : '';
  const temporalParams = asOfMs ? biTemporalParams(asOfMs) : [];
  const params = type === 'all'
    ? [safeQuery, tenantId, ...temporalParams]
    : [safeQuery, type, tenantId, ...temporalParams];
  const count = runFtsGet(sqlite.prepare(`
    SELECT COUNT(*) as total
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    ${temporalJoin}
    WHERE oracle_fts MATCH ? ${typeClause} AND d.tenant_id = ? ${temporalClause}
  `), params) as { total: number } | null;
  const rows = runFtsAll(sqlite.prepare(`
    SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project${temporalSelect}, rank as score
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    ${temporalJoin}
    WHERE oracle_fts MATCH ? ${typeClause} AND d.tenant_id = ? ${temporalClause}
    ORDER BY rank
    LIMIT ? OFFSET ?
  `), [...params, limit, offset]) as ListRow[];

  rows.forEach((row) => logDocumentAccess(row.id, 'search', row.project));

  return {
    results: rows.map((row) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      source_file: row.source_file,
      concepts: parseConcepts(row.concepts),
      project: row.project,
      ...(asOfMs ? { valid_time: isoTimestamp(row.valid_time), valid_until: isoTimestamp(row.valid_until) } : {}),
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

function isoTimestamp(value: number | string | null): string | null {
  const ms = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
