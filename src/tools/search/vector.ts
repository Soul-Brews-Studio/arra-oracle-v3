import { ensureVectorStoreConnected } from '../../vector/factory.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { cosineDistanceToSimilarity } from '../../vector/scoring.ts';
import type { ToolContext } from '../types.ts';
import { parseConceptsFromMetadata } from './helpers.ts';
import type { VectorResult } from './types.ts';

function tenantAllowedIds(ctx: ToolContext, ids: string[], tenantId: string): Set<string> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => '?').join(',');
  const rows = ctx.sqlite.prepare(`
    SELECT id FROM oracle_documents
    WHERE tenant_id = ? AND id IN (${placeholders})
  `).all(tenantId, ...ids) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/** Vector search using the configured vector store, post-filtered by tenant. */
export async function vectorSearch(
  ctx: ToolContext,
  query: string,
  type: string,
  limit: number,
  model?: string,
): Promise<VectorResult[]> {
  try {
    const whereFilter = type !== 'all' ? { type } : undefined;
    const store = model ? await ensureVectorStoreConnected(model) : ctx.vectorStore;
    console.error(`[VectorSearch] Query: "${query.substring(0, 50)}..." limit=${limit} model=${model || 'default'}`);

    const results = await store.query(query, limit, whereFilter);
    console.error(`[VectorSearch] Results: ${results.ids?.length || 0} documents`);
    if (!results.ids || results.ids.length === 0) return [];

    const tenantId = currentTenantId();
    const allowedIds = tenantId ? tenantAllowedIds(ctx, results.ids, tenantId) : null;
    const resolvedModelName = model || 'bge-m3';
    const mappedResults: VectorResult[] = [];

    for (let i = 0; i < results.ids.length; i++) {
      const id = results.ids[i];
      if (allowedIds && !allowedIds.has(id)) continue;
      const metadata = results.metadatas[i] as Record<string, unknown> | null;
      const rawDistance = results.distances[i] || 0;
      const score = cosineDistanceToSimilarity(rawDistance);
      mappedResults.push({
        id,
        type: (metadata?.type as string) || 'unknown',
        content: (results.documents[i] || '').substring(0, 500),
        source_file: (metadata?.source_file as string) || '',
        concepts: parseConceptsFromMetadata(metadata?.concepts),
        score,
        distance: rawDistance,
        model: resolvedModelName,
        source: 'vector',
      });
    }

    return mappedResults;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[Vector ERROR]', errorMsg);
    return [];
  }
}
