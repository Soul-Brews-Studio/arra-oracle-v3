import { count, eq, sql } from 'drizzle-orm';
import { db, indexingStatus, oracleDocuments } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

export function tenantStats() {
  const tenantId = currentTenantId();
  if (!tenantId) return null;

  const projectScope = eq(oracleDocuments.tenantId, tenantId);
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
