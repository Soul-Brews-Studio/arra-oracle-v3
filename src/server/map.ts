/**
 * 2D Knowledge Map — hash-based layout with project clustering
 *
 * Extracted from handlers.ts for maintainability.
 */

import { db, oracleDocuments } from '../db/index.ts';

interface MapDocument {
  id: string;
  type: string;
  source_file: string;
  concepts: string[];
  chunk_ids: string[];
  project: string | null;
  x: number;
  y: number;
  created_at: string | null;
}

interface MapResult {
  documents: MapDocument[];
  total: number;
}

let mapCache: { data: MapResult; timestamp: number } | null = null;
const MAP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function handleMap(): Promise<MapResult> {
  if (mapCache && (Date.now() - mapCache.timestamp) < MAP_CACHE_TTL) {
    return mapCache.data;
  }

  try {
    const result = computeMapLayout();
    mapCache = { data: result, timestamp: Date.now() };
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map Error]', msg);
    throw new Error(`Map generation failed: ${msg}`);
  }
}

/** Compute the full 2D map layout from all documents */
function computeMapLayout(): MapResult {
  const allDocs = db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
    project: oracleDocuments.project,
    createdAt: oracleDocuments.createdAt
  })
    .from(oracleDocuments)
    .all();

  if (allDocs.length === 0) {
    return { documents: [], total: 0 };
  }

  const dedupedDocs = deduplicateByFile(allDocs);
  const { projectMap, clusterCenters } = buildProjectClusters(dedupedDocs);
  const limitedDocs = dedupedDocs.slice(0, 10000);

  const documents = limitedDocs.map((doc) => mapDocToPosition(doc, projectMap, clusterCenters));
  return { documents, total: documents.length };
}

/** Map a deduped doc to a positioned MapDocument */
function mapDocToPosition(
  doc: DedupedDoc,
  projectMap: Map<string, number>,
  clusterCenters: Map<number, { cx: number; cy: number }>
): MapDocument {
  const { x, y } = computeDocPosition(doc, projectMap, clusterCenters);
  return {
    id: doc.id,
    type: doc.type,
    source_file: doc.sourceFile,
    concepts: doc.allConcepts,
    chunk_ids: doc.chunkIds,
    project: doc.project,
    x,
    y,
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : null
  };
}

interface DedupedDoc {
  id: string;
  type: string;
  sourceFile: string;
  allConcepts: string[];
  chunkIds: string[];
  project: string | null;
  createdAt: number | null;
}

/** Deduplicate documents by source_file, merging concepts and chunk IDs */
function deduplicateByFile(allDocs: any[]): DedupedDoc[] {
  const fileMap = new Map<string, DedupedDoc>();

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
        createdAt: doc.createdAt
      });
    } else {
      existing.chunkIds.push(doc.id);
      const newConcepts: string[] = doc.concepts ? JSON.parse(doc.concepts) : [];
      for (const c of newConcepts) {
        if (!existing.allConcepts.includes(c)) existing.allConcepts.push(c);
      }
    }
  }

  return Array.from(fileMap.values());
}

/** Build project cluster centers using Fibonacci sunflower spiral */
function buildProjectClusters(docs: DedupedDoc[]) {
  const projectMap = new Map<string, number>();
  let projectIdx = 0;
  for (const doc of docs) {
    const proj = doc.project || '_default';
    if (!projectMap.has(proj)) projectMap.set(proj, projectIdx++);
  }

  const golden = (1 + Math.sqrt(5)) / 2;
  const totalClusters = projectMap.size;
  const clusterCenters = new Map<number, { cx: number; cy: number }>();
  for (let i = 0; i < totalClusters; i++) {
    const angle = i * golden * Math.PI * 2;
    const r = Math.sqrt((i + 0.5) / totalClusters) * 0.75;
    clusterCenters.set(i, { cx: Math.cos(angle) * r, cy: Math.sin(angle) * r });
  }

  return { projectMap, clusterCenters };
}

/** Compute x,y position for a document within its project cluster */
function computeDocPosition(
  doc: DedupedDoc,
  projectMap: Map<string, number>,
  clusterCenters: Map<number, { cx: number; cy: number }>
): { x: number; y: number } {
  const proj = doc.project || '_default';
  const clusterIdx = projectMap.get(proj) || 0;
  const center = clusterCenters.get(clusterIdx) || { cx: 0, cy: 0 };

  const h1 = simpleHash(doc.sourceFile);
  const h2 = simpleHash(doc.sourceFile + '_y');
  const localX = (h1 - 0.5) * 0.2;
  const localY = (h2 - 0.5) * 0.2;

  return { x: center.cx + localX, y: center.cy + localY };
}

/** Simple deterministic hash -> [0,1) float (FNV-1a) */
function simpleHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10000) / 10000;
}
