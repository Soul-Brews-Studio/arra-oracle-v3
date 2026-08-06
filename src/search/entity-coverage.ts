import type { Database } from 'bun:sqlite';
import { sqlite as defaultSqlite } from '../db/index.ts';
import { currentTenantId } from '../middleware/tenant.ts';

export type EntityCoverageStats = {
  docsIndexed: number;
  docsWithEntities: number;
  docsMissingEntities: number;
  ratio: number;
  checkedAt: string;
  tenantId?: string;
  error?: string;
};

type CountRow = { count: number };

export function readEntityCoverageStats(
  sqlite: Database = defaultSqlite,
  tenantId = currentTenantId(),
): EntityCoverageStats {
  const checkedAt = new Date().toISOString();
  try {
    if (!tableExists(sqlite, 'oracle_documents') || !tableExists(sqlite, 'oracle_fts')) {
      return stats(0, 0, checkedAt, tenantId);
    }
    if (!tableExists(sqlite, 'oracle_entity_links')) {
      const indexed = indexedCount(sqlite, tenantId);
      return { ...stats(indexed, 0, checkedAt, tenantId), error: 'oracle_entity_links missing' };
    }
    return stats(indexedCount(sqlite, tenantId), linkedCount(sqlite, tenantId), checkedAt, tenantId);
  } catch (error) {
    return { ...stats(0, 0, checkedAt, tenantId), error: message(error) };
  }
}

function indexedCount(sqlite: Database, tenantId?: string): number {
  const where = tenantId ? 'WHERE d.tenant_id = ?' : '';
  return count(sqlite, `
    SELECT COUNT(DISTINCT d.id) AS count
    FROM oracle_documents d JOIN oracle_fts f ON f.id = d.id
    ${where}`, tenantId ? [tenantId] : []);
}

function linkedCount(sqlite: Database, tenantId?: string): number {
  const where = tenantId ? 'WHERE d.tenant_id = ?' : '';
  return count(sqlite, `
    SELECT COUNT(DISTINCT d.id) AS count
    FROM oracle_documents d
    JOIN oracle_fts f ON f.id = d.id
    JOIN oracle_entity_links l ON l.document_id = d.id AND l.tenant_id = d.tenant_id
    ${where}`, tenantId ? [tenantId] : []);
}

function stats(indexed: number, linked: number, checkedAt: string, tenantId?: string): EntityCoverageStats {
  const docsIndexed = Math.max(0, indexed);
  const docsWithEntities = Math.min(docsIndexed, Math.max(0, linked));
  const docsMissingEntities = Math.max(0, docsIndexed - docsWithEntities);
  return {
    docsIndexed,
    docsWithEntities,
    docsMissingEntities,
    ratio: docsIndexed === 0 ? 1 : round(docsWithEntities / docsIndexed),
    checkedAt,
    ...(tenantId ? { tenantId } : {}),
  };
}

function count(sqlite: Database, sql: string, params: string[]): number {
  return (sqlite.query<CountRow, string[]>(sql).get(...params)?.count ?? 0);
}

function tableExists(sqlite: Database, name: string): boolean {
  return Boolean(sqlite.query<CountRow, [string]>(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = ? LIMIT 1",
  ).get(name)?.count);
}

function round(value: number): number { return Number(value.toFixed(4)); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
