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
export type SupersedeStatus = { by: string; at: string | null; reason: string | null };

function resultIds(results: SearchResultRecord[]): string[] {
  return [...new Set(results
    .map((result) => result.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

function toDb(input: OracleDbInput): OracleDb {
  return 'prepare' in input ? drizzle(input, { schema }) : input;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function statusFor(by: unknown, at: unknown, reason: unknown): SupersedeStatus | null {
  const target = text(by);
  if (!target) return null;
  return { by: target, at: isoTimestamp(at as number | string | null | undefined), reason: text(reason) };
}

export function normalizeSupersedeStatus(result: SearchResultRecord): SupersedeStatus | null {
  const existing = result.superseded;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const record = existing as Record<string, unknown>;
    const status = statusFor(record.by, record.at, record.reason);
    if (status) return status;
  }
  return statusFor(result.superseded_by ?? result.supersededBy, result.superseded_at ?? result.supersededAt, result.superseded_reason ?? result.supersededReason);
}

function setSupersedeStatus(result: SearchResultRecord, status: SupersedeStatus | null): void {
  result.superseded = status;
  if (!status) return;
  result.superseded_by = status.by;
  result.superseded_at = status.at;
  result.superseded_reason = status.reason;
}

export function supersedeWarnings(results: SearchResultRecord[], label = 'result'): string[] {
  return results.flatMap((result, index) => {
    const status = normalizeSupersedeStatus(result);
    return status ? [`${label}[${index + 1}] superseded by ${status.by}${status.reason ? `: ${status.reason}` : ''}`] : [];
  });
}

export function attachSupersedeStatus(
  dbInput: OracleDbInput,
  results: SearchResultRecord[],
  tenantId = currentTenantId(),
): void {
  const db = toDb(dbInput);
  const ids = resultIds(results);
  for (const result of results) setSupersedeStatus(result, normalizeSupersedeStatus(result));
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
    setSupersedeStatus(result, statusFor(supersede.supersededBy, supersede.supersededAt, supersede.supersededReason));
  }
}
