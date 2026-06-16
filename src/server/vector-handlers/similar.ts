import { and, eq, inArray } from 'drizzle-orm';
import { db, oracleDocuments } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { EMBEDDING_MODELS, ensureVectorStoreConnected } from '../../vector/factory.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';
import type { SearchResult } from '../types.ts';

async function getVectorStore(model?: string): Promise<VectorStoreAdapter> {
  return ensureVectorStoreConnected(model);
}

function tenantDocExists(id: string, tenantId: string): boolean {
  return Boolean(db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(and(eq(oracleDocuments.id, id), eq(oracleDocuments.tenantId, tenantId)))
    .get());
}

export async function handleSimilar(
  docId: string,
  limit = 5,
  model?: string,
): Promise<{ results: SearchResult[]; docId: string }> {
  try {
    const tenantId = currentTenantId();
    if (tenantId && !tenantDocExists(docId, tenantId)) return { results: [], docId };
    const client = await getVectorStore(model && EMBEDDING_MODELS[model] ? model : undefined);
    const chromaResults = await client.queryById(docId, limit);
    if (!chromaResults.ids || chromaResults.ids.length === 0) return { results: [], docId };

    const idFilter = inArray(oracleDocuments.id, chromaResults.ids);
    const rows = db.select({
      id: oracleDocuments.id,
      type: oracleDocuments.type,
      sourceFile: oracleDocuments.sourceFile,
      concepts: oracleDocuments.concepts,
      project: oracleDocuments.project,
    })
      .from(oracleDocuments)
      .where(tenantId ? and(idFilter, eq(oracleDocuments.tenantId, tenantId)) : idFilter)
      .all();
    const docMap = new Map(rows.map((row) => [row.id, row]));

    const results: SearchResult[] = chromaResults.ids.flatMap((id: string, i: number) => {
      const doc = docMap.get(id);
      if (tenantId && !doc) return [];
      const distance = chromaResults.distances?.[i] || 1;
      return [{
        id,
        type: doc?.type || chromaResults.metadatas?.[i]?.type || 'unknown',
        content: chromaResults.documents?.[i] || '',
        source_file: doc?.sourceFile || chromaResults.metadatas?.[i]?.source_file || '',
        concepts: doc?.concepts ? JSON.parse(doc.concepts) : [],
        project: doc?.project,
        source: 'vector' as const,
        score: Math.max(0, 1 - distance / 2),
      }];
    });
    return { results, docId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Similar Search Error]', msg);
    throw new Error(`Similar search failed: ${msg}`);
  }
}
