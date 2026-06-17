import type { Database } from 'bun:sqlite';
import { currentTenantId } from '../middleware/tenant.ts';

export type AsOfParseResult = { ok: true; value?: number } | { ok: false; error: string };

type SearchResultRecord = Record<string, unknown>;
type TemporalRow = { id: string; valid_time: number | string | null; valid_until: number | string | null };

export const BI_TEMPORAL_JOIN = `
LEFT JOIN oracle_documents s
  ON d.superseded_by = s.id AND s.tenant_id = d.tenant_id`;

export const BI_TEMPORAL_WHERE = `
COALESCE(d.valid_time, d.updated_at, d.created_at, d.indexed_at) <= ?
AND (
  d.superseded_by IS NULL
  OR COALESCE(s.valid_time, d.superseded_at) IS NULL
  OR COALESCE(s.valid_time, d.superseded_at) > ?
)`;

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
  sqlite: Database,
  results: SearchResultRecord[],
  asOfMs: number | undefined,
  tenantId = currentTenantId(),
): SearchResultRecord[] {
  if (!asOfMs || results.length === 0) return results;
  const ids = [...new Set(results.map((item) => item.id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => '?').join(',');
  const tenantFilter = tenantId ? 'AND d.tenant_id = ?' : '';
  const rows = sqlite.prepare(`
    SELECT d.id, d.valid_time, COALESCE(s.valid_time, d.superseded_at) as valid_until
    FROM oracle_documents d
    ${BI_TEMPORAL_JOIN}
    WHERE d.id IN (${placeholders}) ${tenantFilter} AND ${BI_TEMPORAL_WHERE}
  `).all(...ids, ...(tenantId ? [tenantId] : []), ...biTemporalParams(asOfMs)) as TemporalRow[];

  const temporal = new Map(rows.map((row) => [row.id, row]));
  return results.filter((item) => {
    if (typeof item.id !== 'string') return false;
    const row = temporal.get(item.id);
    if (!row) return false;
    item.valid_time = isoTimestamp(row.valid_time);
    item.valid_until = isoTimestamp(row.valid_until);
    return true;
  });
}

function isoTimestamp(value: number | string | null): string | null {
  const ms = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
