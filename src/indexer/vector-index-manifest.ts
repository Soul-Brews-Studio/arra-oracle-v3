import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { asOracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { vectorIndexManifest } from '../db/schema.ts';
import type { VectorDocument } from '../vector/types.ts';

export interface VectorManifestRow {
  chunkId: string;
  sourceFile: string;
  modelKey: string;
  contentHash: string;
  updatedAt: number;
  indexedAt: number;
}

export interface VectorManifestEntry extends VectorManifestRow { id: string }

export interface VectorIndexPlan {
  modelKey: string;
  docs: VectorDocument[];
  changedDocs: VectorDocument[];
  staleIds: string[];
  entries: VectorManifestEntry[];
  skipped: number;
  total: number;
}

export function vectorManifestId(modelKey: string, chunkId: string): string {
  return `${modelKey}:${chunkId}`;
}

export function vectorContentHash(doc: VectorDocument): string {
  const payload = JSON.stringify({
    document: normalizeVectorText(doc.document),
    metadata: stableMetadata(doc.metadata),
  });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export function loadVectorIndexManifest(input: OracleDbInput, modelKey: string): Map<string, VectorManifestRow> {
  const db = asOracleDb(input);
  const rows = db.select({
    chunkId: vectorIndexManifest.chunkId,
    sourceFile: vectorIndexManifest.sourceFile,
    modelKey: vectorIndexManifest.modelKey,
    contentHash: vectorIndexManifest.contentHash,
    updatedAt: vectorIndexManifest.updatedAt,
    indexedAt: vectorIndexManifest.indexedAt,
  })
    .from(vectorIndexManifest)
    .where(eq(vectorIndexManifest.modelKey, modelKey))
    .all();
  return new Map(rows.map((row) => [row.chunkId, row]));
}

export function planVectorIndex(
  docs: VectorDocument[],
  previous: Map<string, VectorManifestRow>,
  modelKey: string,
  opts: { force?: boolean; now?: number } = {},
): VectorIndexPlan {
  const now = opts.now ?? Date.now();
  const currentIds = new Set(docs.map((doc) => doc.id));
  const staleIds = [...previous.keys()].filter((chunkId) => !currentIds.has(chunkId));
  const changedDocs: VectorDocument[] = [];
  const entries: VectorManifestEntry[] = [];

  for (const doc of docs) {
    const contentHash = vectorContentHash(doc);
    const prior = previous.get(doc.id);
    const changed = opts.force === true || !prior || prior.contentHash !== contentHash;
    if (changed) changedDocs.push(doc);
    entries.push({
      id: vectorManifestId(modelKey, doc.id),
      chunkId: doc.id,
      sourceFile: sourceFileOf(doc),
      modelKey,
      contentHash,
      updatedAt: now,
      indexedAt: changed ? now : prior.indexedAt,
    });
  }

  return { modelKey, docs, changedDocs, staleIds, entries, skipped: docs.length - changedDocs.length, total: docs.length };
}

export function writeVectorIndexManifest(input: OracleDbInput, plan: VectorIndexPlan): void {
  const db = asOracleDb(input);
  db.transaction((tx) => {
    const staleIds = plan.staleIds.map((chunkId) => vectorManifestId(plan.modelKey, chunkId));
    if (staleIds.length > 0) {
      tx.delete(vectorIndexManifest)
        .where(inArray(vectorIndexManifest.id, staleIds))
        .run();
    }
    for (const entry of plan.entries) {
      tx.insert(vectorIndexManifest)
        .values(entry)
        .onConflictDoUpdate({
          target: vectorIndexManifest.id,
          set: {
            chunkId: entry.chunkId,
            sourceFile: entry.sourceFile,
            modelKey: entry.modelKey,
            contentHash: entry.contentHash,
            updatedAt: entry.updatedAt,
            indexedAt: entry.indexedAt,
          },
        })
        .run();
    }
  });
}

function normalizeVectorText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

function stableMetadata(metadata: Record<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)));
}

function sourceFileOf(doc: VectorDocument): string {
  const source = doc.metadata.source_file;
  return typeof source === 'string' ? source : '';
}
