/**
 * 3D Knowledge Map — Real PCA from LanceDB embeddings
 *
 * Extracted from handlers.ts for maintainability.
 *
 * Algorithm:
 *   1. Load all vectors from LanceDB bge-m3 table
 *   2. Center the data (subtract mean)
 *   3. Compute top 3 principal components via power iteration
 *   4. Project all vectors onto 3 PCs
 *   5. Merge with SQLite metadata
 *   6. Cache result
 */

import { inArray } from 'drizzle-orm';
import { db, oracleDocuments } from '../db/index.ts';
import { getVectorStoreByModel, ensureVectorStoreConnected } from '../vector/factory.ts';

const map3dCaches = new Map<string, { data: any; timestamp: number }>();
const MAP3D_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface Map3dDocument {
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
}

interface Map3dResult {
  documents: Map3dDocument[];
  total: number;
  pca_info: {
    variance_explained: number[];
    n_vectors: number;
    n_dimensions: number;
    computed_at: string;
  };
}

interface FileGroup {
  ids: string[];
  vectors: number[][];
  type: string;
  sourceFile: string;
  concepts: string[];
  project: string | null;
  createdAt: number | null;
}

export async function handleMap3d(model?: string): Promise<Map3dResult> {
  const modelKey = model || 'bge-m3';
  const cached = map3dCaches.get(modelKey);
  if (cached && (Date.now() - cached.timestamp) < MAP3D_CACHE_TTL) {
    return cached.data;
  }

  try {
    console.time(`[Map3D:${modelKey}] Total`);

    const { ids, embeddings, metadatas } = await loadEmbeddings(modelKey);
    if (embeddings.length === 0) {
      return emptyResult();
    }

    const n = embeddings.length;
    const d = embeddings[0].length;
    console.error(`[Map3D] Loaded ${n} vectors x ${d} dimensions`);

    const docLookup = await buildMetadataLookup(ids);
    const { files, avgVectors } = deduplicateByFile(ids, embeddings, metadatas, docLookup, d);

    const nFiles = avgVectors.length;
    console.error(`[Map3D] ${nFiles} unique files after dedup`);

    const { projected, varianceExplained } = runPCA(avgVectors, d, nFiles);
    const documents = buildDocuments(files, projected);

    const result: Map3dResult = {
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
    console.timeEnd(`[Map3D:${modelKey}] Total`);
    console.error(`[Map3D] Result: ${documents.length} documents, ${n} raw vectors`);

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map3D Error]', msg);
    throw new Error(`Map3D generation failed: ${msg}`);
  }
}

function emptyResult(): Map3dResult {
  return {
    documents: [],
    total: 0,
    pca_info: { variance_explained: [], n_vectors: 0, n_dimensions: 0, computed_at: new Date().toISOString() }
  };
}

/** Load all embeddings from the vector store */
async function loadEmbeddings(modelKey: string) {
  console.time(`[Map3D:${modelKey}] Load embeddings`);
  const store = getVectorStoreByModel(modelKey);
  await ensureVectorStoreConnected(modelKey);

  if (!store.getAllEmbeddings) {
    throw new Error('LanceDB adapter does not support getAllEmbeddings');
  }

  const allData = await store.getAllEmbeddings(25000);
  console.timeEnd('[Map3D] Load embeddings');
  return allData;
}

/** Batch-query SQLite for metadata on all document IDs */
async function buildMetadataLookup(ids: string[]) {
  console.time('[Map3D] Metadata lookup');
  const docLookup = new Map<string, {
    type: string;
    sourceFile: string;
    concepts: string[];
    project: string | null;
    createdAt: number | null;
  }>();

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
  return docLookup;
}

/** Deduplicate by source_file, averaging embeddings for multi-chunk files */
function deduplicateByFile(
  ids: string[],
  embeddings: number[][],
  metadatas: any[],
  docLookup: Map<string, any>,
  d: number
): { files: FileGroup[]; avgVectors: number[][] } {
  console.time('[Map3D] Dedup by file');
  const fileGroups = new Map<string, FileGroup>();

  for (let i = 0; i < ids.length; i++) {
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
      if (meta?.concepts) {
        for (const c of meta.concepts) {
          if (!existing.concepts.includes(c)) existing.concepts.push(c);
        }
      }
    }
  }

  const files = Array.from(fileGroups.values());
  const avgVectors = files.map(f => averageVectors(f.vectors, d));
  console.timeEnd('[Map3D] Dedup by file');

  return { files, avgVectors };
}

/** Average multiple vectors into one */
function averageVectors(vectors: number[][], d: number): number[] {
  if (vectors.length === 1) return vectors[0];
  const avg = new Array(d).fill(0);
  for (const v of vectors) {
    for (let j = 0; j < d; j++) avg[j] += v[j];
  }
  const count = vectors.length;
  for (let j = 0; j < d; j++) avg[j] /= count;
  return avg;
}

/** Run PCA via power iteration and project to 3D */
function runPCA(
  avgVectors: number[][],
  d: number,
  nFiles: number
): { projected: { x: number; y: number; z: number }[]; varianceExplained: number[] } {
  console.time('[Map3D] PCA');

  const centered = centerData(avgVectors, d, nFiles);
  const pcaSample = sampleForPCA(centered, nFiles);
  const { components, eigenvalues } = powerIteration(pcaSample, d, 3);

  const totalVariance = eigenvalues.reduce((a, b) => a + b, 0);
  const varianceExplained = eigenvalues.map(e => +(e / (totalVariance || 1)).toFixed(4));

  console.timeEnd('[Map3D] PCA');
  console.error(`[Map3D] Variance explained: ${varianceExplained.map(v => (v * 100).toFixed(1) + '%').join(', ')}`);

  console.time('[Map3D] Project');
  const projected = projectAndNormalize(centered, components, d, nFiles);
  console.timeEnd('[Map3D] Project');

  return { projected, varianceExplained };
}

/** Center data by subtracting the mean */
function centerData(avgVectors: number[][], d: number, n: number): Float64Array[] {
  const mean = new Float64Array(d);
  for (let i = 0; i < n; i++) {
    const v = avgVectors[i];
    for (let j = 0; j < d; j++) mean[j] += v[j];
  }
  for (let j = 0; j < d; j++) mean[j] /= n;

  return avgVectors.map(v => {
    const c = new Float64Array(d);
    for (let j = 0; j < d; j++) c[j] = v[j] - mean[j];
    return c;
  });
}

/** Deterministic sampling for covariance estimation */
function sampleForPCA(centered: Float64Array[], nFiles: number): Float64Array[] {
  const pcaSampleSize = Math.min(nFiles, 5000);
  if (nFiles <= pcaSampleSize) return centered;

  const step = nFiles / pcaSampleSize;
  const sample: Float64Array[] = [];
  for (let i = 0; i < pcaSampleSize; i++) {
    sample.push(centered[Math.floor(i * step)]);
  }
  return sample;
}

/** Covariance-vector product: C*v where C = X^T X / n */
function covTimesVec(pcaSample: Float64Array[], d: number, vec: Float64Array): Float64Array {
  const ns = pcaSample.length;
  const projections = new Float64Array(ns);
  for (let i = 0; i < ns; i++) {
    let dot = 0;
    const row = pcaSample[i];
    for (let j = 0; j < d; j++) dot += row[j] * vec[j];
    projections[i] = dot;
  }
  const result = new Float64Array(d);
  for (let i = 0; i < ns; i++) {
    const p = projections[i];
    const row = pcaSample[i];
    for (let j = 0; j < d; j++) result[j] += row[j] * p;
  }
  for (let j = 0; j < d; j++) result[j] /= ns;
  return result;
}

/** Find a single principal component via power iteration with deflation */
function findComponent(
  pcaSample: Float64Array[], d: number, comp: number, prevComponents: Float64Array[]
): { vector: Float64Array; eigenvalue: number } {
  let v = new Float64Array(d);
  for (let j = 0; j < d; j++) v[j] = Math.sin((comp + 1) * (j + 1) * 0.1);

  for (let iter = 0; iter < 50; iter++) {
    const Cv = covTimesVec(pcaSample, d, v);
    for (let prev = 0; prev < prevComponents.length; prev++) {
      const pc = prevComponents[prev];
      let dot = 0;
      for (let j = 0; j < d; j++) dot += Cv[j] * pc[j];
      for (let j = 0; j < d; j++) Cv[j] -= dot * pc[j];
    }
    let norm = 0;
    for (let j = 0; j < d; j++) norm += Cv[j] * Cv[j];
    norm = Math.sqrt(norm);
    if (norm < 1e-12) break;
    for (let j = 0; j < d; j++) v[j] = Cv[j] / norm;
  }

  const Cv = covTimesVec(pcaSample, d, v);
  let eigenvalue = 0;
  for (let j = 0; j < d; j++) eigenvalue += v[j] * Cv[j];
  return { vector: v, eigenvalue };
}

/** Power iteration for top eigenvectors of the covariance matrix */
function powerIteration(
  pcaSample: Float64Array[], d: number, numComponents: number
): { components: Float64Array[]; eigenvalues: number[] } {
  const components: Float64Array[] = [];
  const eigenvalues: number[] = [];

  for (let comp = 0; comp < numComponents; comp++) {
    const { vector, eigenvalue } = findComponent(pcaSample, d, comp, components);
    components.push(vector);
    eigenvalues.push(eigenvalue);
  }

  return { components, eigenvalues };
}

/** Project centered data onto principal components and normalize to [-1, 1] */
function projectAndNormalize(
  centered: Float64Array[],
  components: Float64Array[],
  d: number,
  nFiles: number
): { x: number; y: number; z: number }[] {
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

  // Normalize to [-1, 1]
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

  return projected;
}

/** Build final document array from file groups and projected coordinates */
function buildDocuments(
  files: FileGroup[],
  projected: { x: number; y: number; z: number }[]
): Map3dDocument[] {
  return files.map((f, i) => {
    const basename = f.sourceFile.split('/').pop() || f.sourceFile;
    const title = basename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

    return {
      id: f.ids[0],
      type: f.type,
      title,
      source_file: f.sourceFile,
      concepts: f.concepts.slice(0, 10),
      project: f.project,
      x: +projected[i].x.toFixed(6),
      y: +projected[i].y.toFixed(6),
      z: +projected[i].z.toFixed(6),
      created_at: f.createdAt ? new Date(f.createdAt).toISOString() : null,
    };
  });
}
