/**
 * Oracle Stats Handler
 *
 * Knowledge base statistics and health status.
 */

import { sql, and, ne, isNotNull } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
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
  const typeCounts = ctx.db.select({
    type: oracleDocuments.type,
    count: sql<number>`count(*)`,
  })
    .from(oracleDocuments)
    .groupBy(oracleDocuments.type)
    .all();

  const byType: Record<string, number> = {};
  let totalDocs = 0;
  for (const row of typeCounts) {
    byType[row.type] = row.count;
    totalDocs += row.count;
  }

  const ftsCount = ctx.sqlite.prepare('SELECT COUNT(*) as count FROM oracle_fts').get() as { count: number };

  const lastIndexed = ctx.db.select({
    lastIndexed: sql<number | null>`MAX(indexed_at)`,
  }).from(oracleDocuments).get();

  const conceptsResult = ctx.db.select({
    concepts: oracleDocuments.concepts,
  })
    .from(oracleDocuments)
    .where(and(isNotNull(oracleDocuments.concepts), ne(oracleDocuments.concepts, '[]')))
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
      }, null, 2)
    }]
  };
}
