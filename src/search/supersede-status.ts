import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import { isoTimestamp } from './timestamp.ts';

type SearchResultRecord = Record<string, unknown>;
type OracleDb = BunSQLiteDatabase<typeof schema>;
type OracleDbInput = OracleDb | Database;

type SupersedeRow = {
  id: string;
  supersededBy: string;
  supersededAt: number | string | null;
  supersededReason: string | null;
};

function resultIds(results: SearchResultRecord[]): string[] {
  return [...new Set(results
    .map((result) => result.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

function toDb(input: OracleDbInput): OracleDb {
  return 'prepare' in input ? drizzle(input, { schema }) : input;
}

export function attachSupersedeStatus(
  dbInput: OracleDbInput,
  results: SearchResultRecord[],
  tenantId = currentTenantId(),
): void {
  const db = toDb(dbInput);
  const ids = resultIds(results);
  if (ids.length === 0) return;

  let rows: SupersedeRow[];
  try {
    rows = db.select({
      id: schema.oracleDocuments.id,
      supersededBy: schema.oracleDocuments.supersededBy,
      supersededAt: schema.oracleDocuments.supersededAt,
      supersededReason: schema.oracleDocuments.supersededReason,
    }).from(schema.oracleDocuments)
      .where(and(
        inArray(schema.oracleDocuments.id, ids),
        isNotNull(schema.oracleDocuments.supersededBy),
        ...(tenantId ? [eq(schema.oracleDocuments.tenantId, tenantId)] : []),
      ))
      .all() as SupersedeRow[];
  } catch (error) {
    console.warn('[SupersedeStatus] lookup failed:', error instanceof Error ? error.message : String(error));
    return;
  }
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const result of results) {
    if (typeof result.id !== 'string') continue;
    const supersede = byId.get(result.id);
    if (!supersede) continue;
    result.superseded_by = supersede.supersededBy;
    result.superseded_at = isoTimestamp(supersede.supersededAt);
    result.superseded_reason = supersede.supersededReason;
  }
}
