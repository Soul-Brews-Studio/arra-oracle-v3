import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
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

export function loadVectorIndexManifest(sqlite: Database, modelKey: string): Map<string, VectorManifestRow> {
  const rows = sqlite.prepare(`
    SELECT chunk_id AS chunkId, source_file AS sourceFile, model_key AS modelKey,
      content_hash AS contentHash, updated_at AS updatedAt, indexed_at AS indexedAt
    FROM vector_index_manifest
    WHERE model_key = ?
  `).all(modelKey) as VectorManifestRow[];
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

export function writeVectorIndexManifest(sqlite: Database, plan: VectorIndexPlan): void {
  const deleteStmt = sqlite.prepare('DELETE FROM vector_index_manifest WHERE id = ?');
  const upsertStmt = sqlite.prepare(`
    INSERT INTO vector_index_manifest
      (id, chunk_id, source_file, model_key, content_hash, updated_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      chunk_id = excluded.chunk_id,
      source_file = excluded.source_file,
      model_key = excluded.model_key,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at,
      indexed_at = excluded.indexed_at
  `);

  sqlite.exec('BEGIN');
  try {
    for (const chunkId of plan.staleIds) deleteStmt.run(vectorManifestId(plan.modelKey, chunkId));
    for (const entry of plan.entries) {
      upsertStmt.run(entry.id, entry.chunkId, entry.sourceFile, entry.modelKey, entry.contentHash, entry.updatedAt, entry.indexedAt);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
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
