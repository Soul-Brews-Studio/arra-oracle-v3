import { count, eq, sql } from 'drizzle-orm';
import { db, indexingStatus, oracleDocuments } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

/** True when this DB also hosts other oracles' rows (tenants joined this arra). */
export function hostsOtherTenants(): boolean {
  return Boolean(db.select({ one: sql<number>`1` }).from(oracleDocuments)
    .where(sql`COALESCE(${oracleDocuments.tenantId}, 'default') <> 'default'`).limit(1).get());
}

/** The tenant a stats read counts: the caller's, else `default` once other tenants share the DB. */
export function statsTenant(): string | null {
  return currentTenantId() ?? (hostsOtherTenants() ? 'default' : null);
}

export function tenantStats() {
  const tenantId = statsTenant();
  if (!tenantId) return null;

  // Without the default case the no-tenant read summed every hosted oracle (327,888 vs 2,630, #3110).
  const projectScope = sql`COALESCE(${oracleDocuments.tenantId}, 'default') = ${tenantId}`;
  const total = db.select({ count: count() })
    .from(oracleDocuments)
    .where(projectScope)
    .get()?.count ?? 0;

  const byTypeRows = db.select({ type: oracleDocuments.type, count: count() })
    .from(oracleDocuments)
    .where(projectScope)
    .groupBy(oracleDocuments.type)
    .all();

  const last = db.select({ lastIndexed: sql<number | null>`max(${oracleDocuments.indexedAt})` })
    .from(oracleDocuments)
    .where(projectScope)
    .get()?.lastIndexed ?? null;

  const indexing = db.select().from(indexingStatus).where(eq(indexingStatus.id, 1)).get();
  return {
    total,
    total_docs: total,
    by_type: Object.fromEntries(byTypeRows.map((row) => [row.type, row.count])),
    last_indexed: last ? new Date(last).toISOString() : null,
    indexing: Boolean(indexing?.isIndexing),
    tenant: { id: tenantId, scope: 'tenant_id' },
  };
}
