/**
 * Oracle Stats Handler
 *
 * Knowledge base statistics and health status.
 */

import { sql, and, eq, ne, isNotNull } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import type { ToolContext, ToolResponse, OracleStatsInput } from './types.ts';

export const statsToolDef = {
  name: 'oracle_stats',
  description: 'Get Oracle knowledge base statistics and health status. Returns document counts by type, indexing status, and ChromaDB connection status.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
};

export async function handleStats(ctx: ToolContext, _input: OracleStatsInput): Promise<ToolResponse> {
  const tenantId = currentTenantId();
  const tenantWhere = tenantId ? eq(oracleDocuments.tenantId, tenantId) : undefined;
  const typeCountQuery = ctx.db.select({ type: oracleDocuments.type, count: sql<number>`count(*)` })
    .from(oracleDocuments)
    .$dynamic();
  const typeCounts = (tenantWhere ? typeCountQuery.where(tenantWhere) : typeCountQuery)
    .groupBy(oracleDocuments.type)
    .all();

  const byType: Record<string, number> = {};
  let totalDocs = 0;
  for (const row of typeCounts) {
    byType[row.type] = row.count;
    totalDocs += row.count;
  }

  const ftsCount = tenantId
    ? ctx.sqlite.prepare(`
        SELECT COUNT(*) as count
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE d.tenant_id = ?
      `).get(tenantId) as { count: number }
    : ctx.sqlite.prepare('SELECT COUNT(*) as count FROM oracle_fts').get() as { count: number };

  const lastIndexedQuery = ctx.db.select({
    lastIndexed: sql<number | null>`MAX(indexed_at)`,
  }).from(oracleDocuments).$dynamic();
  const lastIndexed = (tenantWhere ? lastIndexedQuery.where(tenantWhere) : lastIndexedQuery).get();

  const conceptWhere = tenantWhere
    ? and(isNotNull(oracleDocuments.concepts), ne(oracleDocuments.concepts, '[]'), tenantWhere)
    : and(isNotNull(oracleDocuments.concepts), ne(oracleDocuments.concepts, '[]'));
  const conceptsResult = ctx.db.select({
    concepts: oracleDocuments.concepts,
  })
    .from(oracleDocuments)
    .where(conceptWhere)
    .all();

  const uniqueConcepts = new Set<string>();
  for (const row of conceptsResult) {
    try {
      const concepts = JSON.parse(row.concepts);
      if (Array.isArray(concepts)) {
        concepts.forEach((c: string) => uniqueConcepts.add(c));
      }
    } catch {
      // Ignore parse errors
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        total_documents: totalDocs,
        by_type: byType,
        fts_indexed: ftsCount.count,
        unique_concepts: uniqueConcepts.size,
        last_indexed: lastIndexed?.lastIndexed
          ? new Date(lastIndexed.lastIndexed).toISOString()
          : null,
        vector_status: ctx.vectorStatus,
        fts_status: ftsCount.count > 0 ? 'healthy' : 'empty',
        version: ctx.version,
        ...(tenantId ? { tenant: { id: tenantId, scope: 'tenant_id' } } : {}),
      }, null, 2)
    }]
  };
}
