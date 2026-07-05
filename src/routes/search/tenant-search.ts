import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { BI_TEMPORAL_JOIN, BI_TEMPORAL_WHERE, biTemporalParams } from '../../search/bitemporal.ts';
import { isoTimestamp } from '../../search/timestamp.ts';
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

function randomOffset(total: number): number {
  return Math.floor(Math.random() * total);
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

export function handleTenantList(type = 'all', limit = 10, offset = 0, groupByFile = true, asOfMs?: number): SearchResponse | null {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const typeClause = type === 'all' ? '' : 'AND d.type = ?';
  const temporalJoin = asOfMs ? BI_TEMPORAL_JOIN : '';
  const temporalClause = asOfMs ? `AND ${BI_TEMPORAL_WHERE}` : '';
  const temporalSelect = asOfMs ? ', d.valid_time, COALESCE(s.valid_time, d.superseded_at) as valid_until' : '';
  const temporalParams = asOfMs ? biTemporalParams(asOfMs) : [];
  const params = type === 'all' ? [tenantId, ...temporalParams] : [type, tenantId, ...temporalParams];
  const countExpr = groupByFile ? 'count(distinct d.source_file)' : 'count(*)';
  const count = sqlite.prepare(`
    SELECT ${countExpr} as total
    FROM oracle_documents d
    ${temporalJoin}
    WHERE 1=1 ${typeClause} AND d.tenant_id = ? ${temporalClause}
  `).get(...params) as { total: number };

  const indexedAt = groupByFile ? 'MAX(d.indexed_at)' : 'd.indexed_at';
  const groupSql = groupByFile ? 'GROUP BY d.source_file' : '';
  const rows = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, d.project, ${indexedAt} as indexed_at, f.content${temporalSelect}
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    ${temporalJoin}
    WHERE 1=1 ${typeClause} AND d.tenant_id = ? ${temporalClause}
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
      ...(asOfMs ? { valid_time: isoTimestamp(row.valid_time), valid_until: isoTimestamp(row.valid_until) } : {}),
    })),
    total: count.total,
    offset,
    limit,
  };
}

export function handleTenantReflect(): Record<string, unknown> | null {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const count = sqlite.prepare(`
    SELECT COUNT(*) as total
    FROM oracle_documents d
    WHERE d.tenant_id = ? AND d.type IN ('principle', 'learning')
  `).get(tenantId) as { total: number } | undefined;
  const total = Number(count?.total ?? 0);
  if (total < 1) return { error: 'No documents found', fts_status: 'empty' };

  const row = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, f.content
    FROM oracle_documents d
    LEFT JOIN oracle_fts f ON d.id = f.id
    WHERE d.tenant_id = ? AND d.type IN ('principle', 'learning')
    LIMIT 1 OFFSET ?
  `).get(tenantId, randomOffset(total)) as ListRow | undefined;

  if (!row) return { error: 'No documents found', fts_status: 'empty' };
  if (!row.content) {
    return {
      error: 'Document content not found in FTS index',
      id: row.id,
      type: row.type,
      source_file: row.source_file,
      concepts: parseConcepts(row.concepts),
      fts_status: 'missing',
    };
  }
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    source_file: row.source_file,
    concepts: parseConcepts(row.concepts),
    fts_status: 'healthy',
  };
}
