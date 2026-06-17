import type { Database } from 'bun:sqlite';
import { currentTenantId } from '../middleware/tenant.ts';

type SearchResultRecord = Record<string, unknown>;

type SupersedeRow = {
  id: string;
  superseded_by: string;
  superseded_at: number | string | null;
  superseded_reason: string | null;
};

function resultIds(results: SearchResultRecord[]): string[] {
  return [...new Set(results
    .map((result) => result.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

function isoTimestamp(value: number | string | null): string | null {
  const ms = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function attachSupersedeStatus(
  sqlite: Database,
  results: SearchResultRecord[],
  tenantId = currentTenantId(),
): void {
  const ids = resultIds(results);
  if (ids.length === 0) return;

  const placeholders = ids.map(() => '?').join(',');
  const tenantFilter = tenantId ? 'AND tenant_id = ?' : '';
  let rows: SupersedeRow[];
  try {
    rows = sqlite.prepare(`
      SELECT id, superseded_by, superseded_at, superseded_reason
      FROM oracle_documents
      WHERE id IN (${placeholders}) AND superseded_by IS NOT NULL ${tenantFilter}
    `).all(...ids, ...(tenantId ? [tenantId] : [])) as SupersedeRow[];
  } catch (error) {
    console.warn('[SupersedeStatus] lookup failed:', error instanceof Error ? error.message : String(error));
    return;
  }
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const result of results) {
    if (typeof result.id !== 'string') continue;
    const supersede = byId.get(result.id);
    if (!supersede) continue;
    result.superseded_by = supersede.superseded_by;
    result.superseded_at = isoTimestamp(supersede.superseded_at);
    result.superseded_reason = supersede.superseded_reason;
  }
}
