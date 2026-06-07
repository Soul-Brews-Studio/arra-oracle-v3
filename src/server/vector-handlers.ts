/**
 * Vector-only request handlers.
 *
 * Split out of handlers.ts (#1071 phase 1.1) so the vector subsystem can
 * eventually move behind a network proxy (VECTOR_URL) without touching the
 * FTS / hybrid-search code path.
 *
 * handlers.ts keeps:
 *   - handleSearch (hybrid: FTS + vector)
 *   - handleList, handleReflect, handleStats, handleGraph, handleLearn, …
 *
 * This file owns:
 *   - handleSimilar       (GET /api/similar)
 *   - handleMap           (GET /api/map)
 *   - handleMap3d         (GET /api/map3d)
 *   - handleVectorStats   (GET /api/vector/stats — also reused by /api/stats)
 */

import { inArray } from 'drizzle-orm';
import { db, oracleDocuments } from '../db/index.ts';
import {
  ensureVectorStoreConnected,
  getVectorStoreByModel,
  EMBEDDING_MODELS,
} from '../vector/factory.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import type { SearchResult } from './types.ts';
import { localVectorOperations } from './vector-operations.ts';

/** Convenience wrapper used by every handler in this file. */
async function getVectorStore(model?: string): Promise<VectorStoreAdapter> {
  return ensureVectorStoreConnected(model);
}

// ============================================================================
// /api/similar — vector nearest-neighbor lookup by doc id
// ============================================================================

export async function handleSimilar(
  docId: string,
  limit: number = 5,
  model?: string,
): Promise<{ results: SearchResult[]; docId: string }> {
  try {
    const client = await getVectorStore(model && EMBEDDING_MODELS[model] ? model : undefined);
    const chromaResults = await client.queryById(docId, limit);

    if (!chromaResults.ids || chromaResults.ids.length === 0) {
      return { results: [], docId };
    }

    // Enrich with SQLite data (concepts, project)
    const rows = db.select({
      id: oracleDocuments.id,
      type: oracleDocuments.type,
      sourceFile: oracleDocuments.sourceFile,
      concepts: oracleDocuments.concepts,
      project: oracleDocuments.project,
    })
      .from(oracleDocuments)
      .where(inArray(oracleDocuments.id, chromaResults.ids))
      .all();

    const docMap = new Map(rows.map(r => [r.id, r]));

    const results: SearchResult[] = chromaResults.ids.map((id: string, i: number) => {
      const distance = chromaResults.distances?.[i] || 1;
      const similarity = Math.max(0, 1 - distance / 2);
      const doc = docMap.get(id);

      return {
        id,
        type: doc?.type || chromaResults.metadatas?.[i]?.type || 'unknown',
        content: chromaResults.documents?.[i] || '',
        source_file: doc?.sourceFile || chromaResults.metadatas?.[i]?.source_file || '',
        concepts: doc?.concepts ? JSON.parse(doc.concepts) : [],
        project: doc?.project,
        source: 'vector' as const,
        score: similarity,
      };
    });

    return { results, docId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Similar Search Error]', msg);
    throw new Error(`Similar search failed: ${msg}`);
  }
}

// ============================================================================
// /api/map — 2D layout for the knowledge map
// ============================================================================

/**
 * Compute 2D map coordinates for the knowledge map visualization.
 *
 * NOTE: Despite the function name mentioning PCA, this does NOT use real
 * vector embeddings from ChromaDB. Instead it uses a deterministic hash-based
 * layout: projects are placed via Fibonacci sunflower spiral, then docs are
 * scattered within each project cluster using FNV-1a hash of sourceFile.
 *
 * Why not real embeddings?
 * - getAllEmbeddings() over MCP stdio for 20k+ docs × 384-dim is very slow
 * - numpy array() wrappers in chroma-mcp responses break JSON parsing
 * - PCA projection would need a math library not currently in deps
 *
 * To upgrade: batch-fetch embeddings, run PCA server-side, cache the projection.
 *
 * Caches result in memory to avoid recomputing.
 */
let mapCache: { data: any; timestamp: number } | null = null;
const MAP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function handleMap(): Promise<{
  documents: Array<{
    id: string;
    type: string;
    source_file: string;
    concepts: string[];
    chunk_ids: string[];
    project: string | null;
    x: number;
    y: number;
    created_at: string | null;
  }>;
  total: number;
}> {
  // Return cached result if fresh
  if (mapCache && (Date.now() - mapCache.timestamp) < MAP_CACHE_TTL) {
    return mapCache.data;
  }

  try {
    // Get all docs from SQLite (no ChromaDB dependency)
    const allDocs = db.select({
      id: oracleDocuments.id,
      type: oracleDocuments.type,
      sourceFile: oracleDocuments.sourceFile,
      concepts: oracleDocuments.concepts,
      project: oracleDocuments.project,
      createdAt: oracleDocuments.createdAt,
    })
      .from(oracleDocuments)
      .all();

    if (allDocs.length === 0) {
      return { documents: [], total: 0 };
    }

    // Deduplicate by source_file — merge concepts and collect chunk IDs
    const fileMap = new Map<string, {
      id: string;
      type: string;
      sourceFile: string;
      allConcepts: string[];
      chunkIds: string[];
      project: string | null;
      createdAt: number | null;
    }>();
    for (const doc of allDocs) {
      const key = doc.sourceFile;
      const existing = fileMap.get(key);
      if (!existing) {
        const concepts = doc.concepts ? JSON.parse(doc.concepts) : [];
        fileMap.set(key, {
          id: doc.id,
          type: doc.type,
          sourceFile: doc.sourceFile,
          allConcepts: concepts,
          chunkIds: [doc.id],
          project: doc.project || null,
          createdAt: doc.createdAt,
        });
      } else {
        existing.chunkIds.push(doc.id);
        const newConcepts: string[] = doc.concepts ? JSON.parse(doc.concepts) : [];
        for (const c of newConcepts) {
          if (!existing.allConcepts.includes(c)) existing.allConcepts.push(c);
        }
      }
    }
    const dedupedDocs = Array.from(fileMap.values());

    // Group by project for spatial clustering
    const projectMap = new Map<string, number>();
    let projectIdx = 0;
    for (const doc of dedupedDocs) {
      const proj = doc.project || '_default';
      if (!projectMap.has(proj)) projectMap.set(proj, projectIdx++);
    }

    // Place cluster centers using Fibonacci sunflower (fills disk, no donut)
    const golden = (1 + Math.sqrt(5)) / 2;
    const totalClusters = projectMap.size;
    const clusterCenters = new Map<number, { cx: number; cy: number }>();
    for (let i = 0; i < totalClusters; i++) {
      const angle = i * golden * Math.PI * 2;
      const r = Math.sqrt((i + 0.5) / totalClusters) * 0.75;
      clusterCenters.set(i, { cx: Math.cos(angle) * r, cy: Math.sin(angle) * r });
    }

    // Apply limit after dedup
    const limitedDocs = dedupedDocs.slice(0, 10000);

    const documents = limitedDocs.map((doc) => {
      const proj = doc.project || '_default';
      const clusterIdx = projectMap.get(proj) || 0;
      const center = clusterCenters.get(clusterIdx) || { cx: 0, cy: 0 };

      // Hash-based scatter within cluster — use sourceFile for stable position per file
      const h1 = simpleHash(doc.sourceFile);
      const h2 = simpleHash(doc.sourceFile + '_y');
      // Map uniform [0,1) to roughly gaussian spread
      const localX = (h1 - 0.5) * 0.2;
      const localY = (h2 - 0.5) * 0.2;

      const x = center.cx + localX;
      const y = center.cy + localY;

      return {
        id: doc.id,
        type: doc.type,
        source_file: doc.sourceFile,
        concepts: doc.allConcepts,
        chunk_ids: doc.chunkIds,
        project: doc.project,
        x,
        y,
        created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
      };
    });

    const result = { documents, total: documents.length };
    mapCache = { data: result, timestamp: Date.now() };
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map Error]', msg);
    throw new Error(`Map generation failed: ${msg}`);
  }
}

/** Simple deterministic hash → [0,1) float */
function simpleHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

// ============================================================================
// /api/map3d — Real PCA from LanceDB embeddings
// ============================================================================

const map3dCaches = new Map<string, { data: any; timestamp: number }>();
const MAP3D_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (PCA is expensive)

/**
 * PCA projection of real embeddings from LanceDB (bge-m3, 1024d → 3d).
 *
 * Algorithm:
 *   1. Load all vectors from LanceDB bge-m3 table
 *   2. Center the data (subtract mean)
 *   3. Compute top 3 principal components via power iteration on covariance matrix
 *   4. Project all vectors onto 3 PCs
 *   5. Merge with SQLite metadata (type, concepts, project)
 *   6. Cache result (recompute on cache expiry)
 */
export async function handleMap3d(model?: string): Promise<{
  documents: Array<{
    id: string;
    type: string;
    title: string;
    source_file: string;
    concepts: string[];
    project: string | null;
    x: number;
    y: number;
    z: number;
    created_at: string | null;
  }>;
  total: number;
  pca_info: {
    variance_explained: number[];
    n_vectors: number;
    n_dimensions: number;
    computed_at: string;
  };
}> {
  const modelKey = model || 'bge-m3';
  const cached = map3dCaches.get(modelKey);
  if (cached && (Date.now() - cached.timestamp) < MAP3D_CACHE_TTL) {
    return cached.data;
  }

  try {
    console.time(`[Map3D:${modelKey}] Total`);

    // Step 1: Get vector store for requested model
    console.time(`[Map3D:${modelKey}] Load embeddings`);
    const store = getVectorStoreByModel(modelKey);
    await ensureVectorStoreConnected(modelKey);

    if (!store.getAllEmbeddings) {
      throw new Error('LanceDB adapter does not support getAllEmbeddings');
    }

    const allData = await store.getAllEmbeddings(25000);
    const { ids, embeddings, metadatas } = allData;
    console.timeEnd('[Map3D] Load embeddings');

    if (embeddings.length === 0) {
      return { documents: [], total: 0, pca_info: { variance_explained: [], n_vectors: 0, n_dimensions: 0, computed_at: new Date().toISOString() } };
    }

    const n = embeddings.length;
    const d = embeddings[0].length;
    console.error(`[Map3D] Loaded ${n} vectors × ${d} dimensions`);

    // Step 2: Build metadata lookup from SQLite
    console.time('[Map3D] Metadata lookup');
    const docLookup = new Map<string, {
      type: string;
      sourceFile: string;
      concepts: string[];
      project: string | null;
      createdAt: number | null;
    }>();

    // Batch query SQLite for all doc IDs
    const batchSize = 500;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const rows = db.select({
        id: oracleDocuments.id,
        type: oracleDocuments.type,
        sourceFile: oracleDocuments.sourceFile,
        concepts: oracleDocuments.concepts,
        project: oracleDocuments.project,
        createdAt: oracleDocuments.createdAt,
      })
        .from(oracleDocuments)
        .where(inArray(oracleDocuments.id, batch))
        .all();

      for (const row of rows) {
        docLookup.set(row.id, {
          type: row.type,
          sourceFile: row.sourceFile,
          concepts: row.concepts ? JSON.parse(row.concepts) : [],
          project: row.project || null,
          createdAt: row.createdAt,
        });
      }
    }
    console.timeEnd('[Map3D] Metadata lookup');

    // Step 3: Deduplicate by source_file (average embeddings for multi-chunk files)
    console.time('[Map3D] Dedup by file');
    const fileGroups = new Map<string, {
      ids: string[];
      vectors: number[][];
      type: string;
      sourceFile: string;
      concepts: string[];
      project: string | null;
      createdAt: number | null;
    }>();

    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const meta = docLookup.get(id);
      const vecMeta = metadatas[i];
      const sourceFile = meta?.sourceFile || vecMeta?.source_file || id;
      const existing = fileGroups.get(sourceFile);

      if (!existing) {
        fileGroups.set(sourceFile, {
          ids: [id],
          vectors: [embeddings[i]],
          type: meta?.type || vecMeta?.type || 'unknown',
          sourceFile,
          concepts: meta?.concepts || [],
          project: meta?.project || null,
          createdAt: meta?.createdAt || null,
        });
      } else {
        existing.ids.push(id);
        existing.vectors.push(embeddings[i]);
        // Merge concepts
        if (meta?.concepts) {
          for (const c of meta.concepts) {
            if (!existing.concepts.includes(c)) existing.concepts.push(c);
          }
        }
      }
    }

    // Average the vectors for each file
    const files = Array.from(fileGroups.values());
    const avgVectors: number[][] = files.map(f => {
      if (f.vectors.length === 1) return f.vectors[0];
      const avg = new Array(d).fill(0);
      for (const v of f.vectors) {
        for (let j = 0; j < d; j++) avg[j] += v[j];
      }
      const count = f.vectors.length;
      for (let j = 0; j < d; j++) avg[j] /= count;
      return avg;
    });
    console.timeEnd('[Map3D] Dedup by file');

    const nFiles = avgVectors.length;
    console.error(`[Map3D] ${nFiles} unique files after dedup`);

    // Step 4: PCA via power iteration
    console.time('[Map3D] PCA');

    // 4a. Compute mean
    const mean = new Float64Array(d);
    for (let i = 0; i < nFiles; i++) {
      const v = avgVectors[i];
      for (let j = 0; j < d; j++) mean[j] += v[j];
    }
    for (let j = 0; j < d; j++) mean[j] /= nFiles;

    // 4b. Center the data (in-place for memory efficiency)
    const centered = avgVectors.map(v => {
      const c = new Float64Array(d);
      for (let j = 0; j < d; j++) c[j] = v[j] - mean[j];
      return c;
    });

    // 4c. Sample for covariance estimation if too many vectors
    const pcaSampleSize = Math.min(nFiles, 5000);
    let pcaSample: Float64Array[];
    if (nFiles <= pcaSampleSize) {
      pcaSample = centered;
    } else {
      // Deterministic sampling: every k-th element
      const step = nFiles / pcaSampleSize;
      pcaSample = [];
      for (let i = 0; i < pcaSampleSize; i++) {
        pcaSample.push(centered[Math.floor(i * step)]);
      }
    }

    // 4d. Power iteration for top 3 eigenvectors
    const numComponents = 3;
    const components: Float64Array[] = [];
    const eigenvalues: number[] = [];

    // Helper: matrix-vector product C*v where C = X^T X / n (covariance)
    // Instead of forming the d×d covariance matrix, compute via X * (X^T * v)
    function covTimesVec(vec: Float64Array): Float64Array {
      const ns = pcaSample.length;
      // First: X^T * v → scalar per sample
      const projections = new Float64Array(ns);
      for (let i = 0; i < ns; i++) {
        let dot = 0;
        const row = pcaSample[i];
        for (let j = 0; j < d; j++) dot += row[j] * vec[j];
        projections[i] = dot;
      }
      // Then: X * projections → d-dimensional result
      const result = new Float64Array(d);
      for (let i = 0; i < ns; i++) {
        const p = projections[i];
        const row = pcaSample[i];
        for (let j = 0; j < d; j++) result[j] += row[j] * p;
      }
      // Divide by n
      for (let j = 0; j < d; j++) result[j] /= ns;
      return result;
    }

    for (let comp = 0; comp < numComponents; comp++) {
      // Random-ish initial vector (deterministic seed)
      let v = new Float64Array(d);
      for (let j = 0; j < d; j++) v[j] = Math.sin((comp + 1) * (j + 1) * 0.1);

      // Deflate: remove projection onto already-found components
      function deflate(vec: Float64Array): Float64Array {
        const result = covTimesVec(vec);
        for (let prev = 0; prev < comp; prev++) {
          const pc = components[prev];
          let dot = 0;
          for (let j = 0; j < d; j++) dot += result[j] * pc[j];
          for (let j = 0; j < d; j++) result[j] -= dot * pc[j];
        }
        return result;
      }

      // Power iteration (50 iterations is plenty for convergence)
      for (let iter = 0; iter < 50; iter++) {
        const Cv = deflate(v);
        // Normalize
        let norm = 0;
        for (let j = 0; j < d; j++) norm += Cv[j] * Cv[j];
        norm = Math.sqrt(norm);
        if (norm < 1e-12) break;
        for (let j = 0; j < d; j++) v[j] = Cv[j] / norm;
      }

      // Compute eigenvalue (Rayleigh quotient)
      const Cv = covTimesVec(v);
      let eigenvalue = 0;
      for (let j = 0; j < d; j++) eigenvalue += v[j] * Cv[j];
      eigenvalues.push(eigenvalue);

      components.push(v);
    }

    // Compute variance explained
    const totalVariance = eigenvalues.reduce((a, b) => a + b, 0);
    const varianceExplained = eigenvalues.map(e => +(e / (totalVariance || 1)).toFixed(4));

    console.timeEnd('[Map3D] PCA');
    console.error(`[Map3D] Variance explained: ${varianceExplained.map(v => (v * 100).toFixed(1) + '%').join(', ')}`);

    // Step 5: Project all vectors onto 3 PCs
    console.time('[Map3D] Project');
    const projected: { x: number; y: number; z: number }[] = [];

    for (let i = 0; i < nFiles; i++) {
      const v = centered[i];
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < d; j++) {
        x += v[j] * components[0][j];
        y += v[j] * components[1][j];
        z += v[j] * components[2][j];
      }
      projected.push({ x, y, z });
    }

    // Normalize to [-1, 1] range for the frontend
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of projected) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rangeZ = maxZ - minZ || 1;

    for (const p of projected) {
      p.x = ((p.x - minX) / rangeX) * 2 - 1;
      p.y = ((p.y - minY) / rangeY) * 2 - 1;
      p.z = ((p.z - minZ) / rangeZ) * 2 - 1;
    }
    console.timeEnd('[Map3D] Project');

    // Step 6: Build response
    const documents = files.map((f, i) => {
      // Title: last part of source_file path, without extension
      const basename = f.sourceFile.split('/').pop() || f.sourceFile;
      const title = basename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

      return {
        id: f.ids[0],
        type: f.type,
        title,
        source_file: f.sourceFile,
        concepts: f.concepts.slice(0, 10), // cap concepts per doc
        project: f.project,
        x: +projected[i].x.toFixed(6),
        y: +projected[i].y.toFixed(6),
        z: +projected[i].z.toFixed(6),
        created_at: f.createdAt ? new Date(f.createdAt).toISOString() : null,
      };
    });

    const result = {
      documents,
      total: documents.length,
      pca_info: {
        variance_explained: varianceExplained,
        n_vectors: n,
        n_dimensions: d,
        computed_at: new Date().toISOString(),
      },
    };

    map3dCaches.set(modelKey, { data: result, timestamp: Date.now() });
    console.timeEnd('[Map3D] Total');
    console.error(`[Map3D] Result: ${documents.length} documents, ${n} raw vectors`);

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map3D Error]', msg);
    throw new Error(`Map3D generation failed: ${msg}`);
  }
}

// ============================================================================
// /api/vector/stats — per-engine collection counts (also feeds /api/stats)
// ============================================================================

/**
 * Get vector DB stats for the stats endpoint.
 * Uses getStats() which returns the count from each engine's collection.
 */
export async function handleVectorStats(): Promise<{
  vector: { enabled: boolean; count: number; collection: string };
  vectors?: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }>;
}> {
  return localVectorOperations.stats();
}

// ============================================================================
// /api/vector/health — adapter liveness probe
// ============================================================================

/**
 * Ping each registered vector engine and report whether the adapter
 * connects + responds to getStats() within the timeout.
 *
 * Lighter than handleVectorStats: no count, no aggregation — just
 * "is the vector layer reachable?". Cheap enough to call from a
 * load balancer.
 */
export async function handleVectorHealth(): Promise<{
  status: 'ok' | 'degraded' | 'down';
  engines: Array<{ key: string; model: string; collection: string; ok: boolean; error?: string }>;
  checked_at: string;
}> {
  return localVectorOperations.health();
}
