import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { alias } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import { isoTimestamp } from './timestamp.ts';

export type AsOfParseResult = { ok: true; value?: number } | { ok: false; error: string };

type SearchResultRecord = Record<string, unknown>;
type OracleDb = BunSQLiteDatabase<typeof schema>;
type OracleDbInput = OracleDb | Database;
type TemporalRow = { id: string; validTime: number | string | null; validUntil: number | string | null };

const validStart = timestampSql('COALESCE(d.valid_time, d.updated_at, d.created_at, d.indexed_at)');
const validUntil = timestampSql('COALESCE(s.valid_time, d.superseded_at)');

export const BI_TEMPORAL_JOIN = `
LEFT JOIN oracle_documents s
  ON d.superseded_by = s.id AND s.tenant_id = d.tenant_id`;

export const BI_TEMPORAL_WHERE = `
${validStart} <= ?
AND (
  d.superseded_by IS NULL
  OR COALESCE(s.valid_time, d.superseded_at) IS NULL
  OR ${validUntil} > ?
)`;

const supersedingDocuments = alias(schema.oracleDocuments, 's');

function timestampSql(expr: string): string {
  return `CASE
    WHEN typeof(${expr}) = 'text' AND ${expr} GLOB '*[^0-9]*'
      THEN CAST(strftime('%s', ${expr}) AS INTEGER) * 1000
    ELSE CAST(${expr} AS INTEGER)
  END`;
}

function timestampExpr(expr: ReturnType<typeof sql>): ReturnType<typeof sql> {
  return sql`CASE
    WHEN typeof(${expr}) = 'text' AND ${expr} GLOB '*[^0-9]*'
      THEN CAST(strftime('%s', ${expr}) AS INTEGER) * 1000
    ELSE CAST(${expr} AS INTEGER)
  END`;
}

function toDb(input: OracleDbInput): OracleDb {
  return 'prepare' in input ? drizzle(input, { schema }) : input;
}

export function parseAsOf(raw: string | undefined): AsOfParseResult {
  const value = raw?.trim();
  if (!value) return { ok: true };
  const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms <= 0) return { ok: false, error: 'Invalid asOf timestamp' };
  return { ok: true, value: ms };
}

export function biTemporalParams(asOfMs: number): [number, number] {
  return [asOfMs, asOfMs];
}

export function filterResultsAsOf(
  dbInput: OracleDbInput,
  results: SearchResultRecord[],
  asOfMs: number | undefined,
  tenantId = currentTenantId(),
): SearchResultRecord[] {
  const db = toDb(dbInput);
  if (!asOfMs || results.length === 0) return results;
  const ids = [...new Set(results.map((item) => item.id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return [];

  const validStartExpr = timestampExpr(sql`COALESCE(
    ${schema.oracleDocuments.validTime},
    ${schema.oracleDocuments.updatedAt},
    ${schema.oracleDocuments.createdAt},
    ${schema.oracleDocuments.indexedAt}
  )`);
  const validUntilRaw = sql`COALESCE(${supersedingDocuments.validTime}, ${schema.oracleDocuments.supersededAt})`;
  const validUntilExpr = timestampExpr(validUntilRaw);
  const rows = db.select({
    id: schema.oracleDocuments.id,
    validTime: schema.oracleDocuments.validTime,
    validUntil: validUntilRaw,
  }).from(schema.oracleDocuments)
    .leftJoin(supersedingDocuments, and(
      eq(schema.oracleDocuments.supersededBy, supersedingDocuments.id),
      eq(supersedingDocuments.tenantId, schema.oracleDocuments.tenantId),
    ))
    .where(and(
      inArray(schema.oracleDocuments.id, ids),
      ...(tenantId ? [eq(schema.oracleDocuments.tenantId, tenantId)] : []),
      sql`${validStartExpr} <= ${asOfMs}`,
      or(
        sql`${schema.oracleDocuments.supersededBy} IS NULL`,
        sql`${validUntilRaw} IS NULL`,
        sql`${validUntilExpr} > ${asOfMs}`,
      ),
    ))
    .all() as TemporalRow[];

  const temporal = new Map(rows.map((row) => [row.id, row]));
  return results.filter((item) => {
    if (typeof item.id !== 'string') return false;
    const row = temporal.get(item.id);
    if (!row) return false;
    item.valid_time = isoTimestamp(row.validTime);
    item.valid_until = isoTimestamp(row.validUntil);
    return true;
  });
}
