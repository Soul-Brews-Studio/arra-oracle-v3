import { eq } from 'drizzle-orm';
import { db, oracleDocuments } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

type MapDoc = {
  id: string;
  type: string;
  source_file: string;
  concepts: string[];
  chunk_ids: string[];
  project: string | null;
  x: number;
  y: number;
  created_at: string | null;
};

type CachedMap = { data: { documents: MapDoc[]; total: number }; timestamp: number; key: string };
const MAP_CACHE_TTL = 5 * 60 * 1000;
let mapCache: CachedMap | null = null;

function simpleHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function concepts(value: string | null): string[] {
  try { return value ? JSON.parse(value) : []; } catch { return []; }
}

export async function handleMap(): Promise<{ documents: MapDoc[]; total: number }> {
  const tenantId = currentTenantId();
  const cacheKey = tenantId ?? '*';
  if (mapCache?.key === cacheKey && (Date.now() - mapCache.timestamp) < MAP_CACHE_TTL) {
    return mapCache.data;
  }

  try {
    const query = db.select({
      id: oracleDocuments.id,
      type: oracleDocuments.type,
      sourceFile: oracleDocuments.sourceFile,
      concepts: oracleDocuments.concepts,
      project: oracleDocuments.project,
      createdAt: oracleDocuments.createdAt,
    }).from(oracleDocuments).$dynamic();
    const allDocs = (tenantId ? query.where(eq(oracleDocuments.tenantId, tenantId)) : query).all();
    if (allDocs.length === 0) return { documents: [], total: 0 };

    const fileMap = new Map<string, {
      id: string; type: string; sourceFile: string; allConcepts: string[];
      chunkIds: string[]; project: string | null; createdAt: number | null;
    }>();
    for (const doc of allDocs) {
      const existing = fileMap.get(doc.sourceFile);
      if (!existing) {
        fileMap.set(doc.sourceFile, {
          id: doc.id,
          type: doc.type,
          sourceFile: doc.sourceFile,
          allConcepts: concepts(doc.concepts),
          chunkIds: [doc.id],
          project: doc.project || null,
          createdAt: doc.createdAt,
        });
        continue;
      }
      existing.chunkIds.push(doc.id);
      for (const concept of concepts(doc.concepts)) {
        if (!existing.allConcepts.includes(concept)) existing.allConcepts.push(concept);
      }
    }

    const dedupedDocs = Array.from(fileMap.values());
    const projectMap = new Map<string, number>();
    for (const doc of dedupedDocs) {
      const proj = doc.project || '_default';
      if (!projectMap.has(proj)) projectMap.set(proj, projectMap.size);
    }
    const golden = (1 + Math.sqrt(5)) / 2;
    const clusterCenters = new Map<number, { cx: number; cy: number }>();
    for (let i = 0; i < projectMap.size; i++) {
      const angle = i * golden * Math.PI * 2;
      const r = Math.sqrt((i + 0.5) / projectMap.size) * 0.75;
      clusterCenters.set(i, { cx: Math.cos(angle) * r, cy: Math.sin(angle) * r });
    }

    const documents = dedupedDocs.slice(0, 10000).map((doc) => {
      const clusterIdx = projectMap.get(doc.project || '_default') || 0;
      const center = clusterCenters.get(clusterIdx) || { cx: 0, cy: 0 };
      return {
        id: doc.id,
        type: doc.type,
        source_file: doc.sourceFile,
        concepts: doc.allConcepts,
        chunk_ids: doc.chunkIds,
        project: doc.project,
        x: center.cx + (simpleHash(doc.sourceFile) - 0.5) * 0.2,
        y: center.cy + (simpleHash(`${doc.sourceFile}_y`) - 0.5) * 0.2,
        created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
      };
    });
    const result = { documents, total: documents.length };
    mapCache = { data: result, timestamp: Date.now(), key: cacheKey };
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map Error]', msg);
    throw new Error(`Map generation failed: ${msg}`);
  }
}
