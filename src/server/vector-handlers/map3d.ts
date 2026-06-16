import { and, eq, inArray } from 'drizzle-orm';
import { db, oracleDocuments } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { ensureVectorStoreConnected, getVectorStoreByModel } from '../../vector/factory.ts';
import { projectPca } from './map3d-pca.ts';

type Map3dDoc = {
  id: string; type: string; title: string; source_file: string; concepts: string[];
  project: string | null; x: number; y: number; z: number; created_at: string | null;
};
type FileGroup = {
  ids: string[]; vectors: number[][]; type: string; sourceFile: string;
  concepts: string[]; project: string | null; createdAt: number | null;
};

type Map3dResult = {
  documents: Map3dDoc[];
  total: number;
  pca_info: { variance_explained: number[]; n_vectors: number; n_dimensions: number; computed_at: string };
};

const map3dCaches = new Map<string, { data: Map3dResult; timestamp: number }>();
const MAP3D_CACHE_TTL = 30 * 60 * 1000;
const emptyResult = (): Map3dResult => ({
  documents: [],
  total: 0,
  pca_info: { variance_explained: [], n_vectors: 0, n_dimensions: 0, computed_at: new Date().toISOString() },
});

function concepts(value: string | null): string[] {
  try { return value ? JSON.parse(value) : []; } catch { return []; }
}

function averageVectors(files: FileGroup[], d: number): number[][] {
  return files.map((file) => {
    if (file.vectors.length === 1) return file.vectors[0];
    const avg = new Array(d).fill(0);
    for (const vector of file.vectors) for (let j = 0; j < d; j++) avg[j] += vector[j];
    for (let j = 0; j < d; j++) avg[j] /= file.vectors.length;
    return avg;
  });
}

function title(sourceFile: string): string {
  return (sourceFile.split('/').pop() || sourceFile).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

export async function handleMap3d(model?: string): Promise<Map3dResult> {
  const modelKey = model || 'bge-m3';
  const tenantId = currentTenantId();
  const cacheKey = `${tenantId ?? '*'}:${modelKey}`;
  const cached = map3dCaches.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < MAP3D_CACHE_TTL) return cached.data;

  try {
    const store = getVectorStoreByModel(modelKey);
    await ensureVectorStoreConnected(modelKey);
    if (!store.getAllEmbeddings) throw new Error('LanceDB adapter does not support getAllEmbeddings');
    const { ids, embeddings, metadatas } = await store.getAllEmbeddings(25000);
    if (embeddings.length === 0) return emptyResult();

    const docLookup = new Map<string, { type: string; sourceFile: string; concepts: string[]; project: string | null; createdAt: number | null }>();
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const idFilter = inArray(oracleDocuments.id, batch);
      const rows = db.select({
        id: oracleDocuments.id,
        type: oracleDocuments.type,
        sourceFile: oracleDocuments.sourceFile,
        concepts: oracleDocuments.concepts,
        project: oracleDocuments.project,
        createdAt: oracleDocuments.createdAt,
      })
        .from(oracleDocuments)
        .where(tenantId ? and(idFilter, eq(oracleDocuments.tenantId, tenantId)) : idFilter)
        .all();
      for (const row of rows) {
        docLookup.set(row.id, {
          type: row.type,
          sourceFile: row.sourceFile,
          concepts: concepts(row.concepts),
          project: row.project || null,
          createdAt: row.createdAt,
        });
      }
    }

    const fileGroups = new Map<string, FileGroup>();
    for (let i = 0; i < embeddings.length; i++) {
      const meta = docLookup.get(ids[i]);
      if (tenantId && !meta) continue;
      const vecMeta = metadatas[i];
      const sourceFile = meta?.sourceFile || vecMeta?.source_file || ids[i];
      const existing = fileGroups.get(sourceFile);
      if (!existing) {
        fileGroups.set(sourceFile, {
          ids: [ids[i]],
          vectors: [embeddings[i]],
          type: meta?.type || vecMeta?.type || 'unknown',
          sourceFile,
          concepts: meta?.concepts || [],
          project: meta?.project || null,
          createdAt: meta?.createdAt || null,
        });
        continue;
      }
      existing.ids.push(ids[i]);
      existing.vectors.push(embeddings[i]);
      for (const concept of meta?.concepts || []) if (!existing.concepts.includes(concept)) existing.concepts.push(concept);
    }

    const files = Array.from(fileGroups.values());
    if (files.length === 0) return emptyResult();
    const avgVectors = averageVectors(files, embeddings[0].length);
    const { projected, varianceExplained } = projectPca(avgVectors);
    const documents = files.map((file, i) => ({
      id: file.ids[0],
      type: file.type,
      title: title(file.sourceFile),
      source_file: file.sourceFile,
      concepts: file.concepts.slice(0, 10),
      project: file.project,
      x: +projected[i].x.toFixed(6),
      y: +projected[i].y.toFixed(6),
      z: +projected[i].z.toFixed(6),
      created_at: file.createdAt ? new Date(file.createdAt).toISOString() : null,
    }));
    const result = {
      documents,
      total: documents.length,
      pca_info: { variance_explained: varianceExplained, n_vectors: embeddings.length, n_dimensions: embeddings[0].length, computed_at: new Date().toISOString() },
    };
    map3dCaches.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map3D Error]', msg);
    throw new Error(`Map3D generation failed: ${msg}`);
  }
}
