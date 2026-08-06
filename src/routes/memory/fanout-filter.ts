import type { Database } from 'bun:sqlite';
import { currentTenantId } from '../../middleware/tenant.ts';
import { BI_TEMPORAL_JOIN, BI_TEMPORAL_WHERE, biTemporalParams } from '../../search/bitemporal.ts';
import { isoTimestamp } from '../../search/timestamp.ts';
import type { FanoutSearchResult } from './fanout-results.ts';

type Row = {
  id: string;
  valid_time: number | string | null;
  valid_until: number | string | null;
};

export function fanoutVectorWhere(): Record<string, string> | undefined {
  const tenantId = currentTenantId();
  return tenantId ? { tenant_id: tenantId } : undefined;
}

export function filterFanoutCandidates(
  db: Database,
  results: FanoutSearchResult[],
  asOfMs: number | undefined,
  tenantId = currentTenantId(),
): FanoutSearchResult[] {
  if ((!tenantId && !asOfMs) || results.length === 0) return results;
  const ids = [...new Set(results.map((item) => item.id).filter(Boolean))];
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => '?').join(',');
  const temporalClause = asOfMs ? `AND ${BI_TEMPORAL_WHERE}` : '';
  const tenantClause = tenantId ? 'AND d.tenant_id = ?' : '';
  const rows = db.prepare(`
    SELECT d.id, d.valid_time, COALESCE(s.valid_time, d.superseded_at) as valid_until
    FROM oracle_documents d
    ${BI_TEMPORAL_JOIN}
    WHERE d.id IN (${placeholders}) ${tenantClause} ${temporalClause}
  `).all(...ids, ...(tenantId ? [tenantId] : []), ...(asOfMs ? biTemporalParams(asOfMs) : [])) as Row[];

  const allowed = new Map(rows.map((row) => [row.id, row]));
  return results.filter((item) => {
    const row = allowed.get(item.id);
    if (!row) return false;
    if (asOfMs) {
      item.valid_time = isoTimestamp(row.valid_time);
      item.valid_until = isoTimestamp(row.valid_until);
    }
    return true;
  });
}
