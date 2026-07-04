import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { asOracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { vectorIndexManifest } from '../db/schema.ts';
import type { VectorDocument, VectorStoreAdapter } from '../vector/types.ts';

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

export interface VectorIndexApplyResult {
  embedded: number;
  deleted: number;
  replaced: boolean;
  aborted: boolean;
}

export interface VectorIndexApplyOptions {
  batchSize?: number;
  replaceBaseline?: boolean;
  shouldAbort?: () => boolean;
  onProgress?: (embedded: number, total: number, action: 'embedded' | 'replaced') => void;
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
  try {
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
  } catch (error) {
    if (isMissingManifestTable(error)) return new Map();
    throw error;
  }
}

export function planVectorIndex(
  docs: VectorDocument[],
  previous: Map<string, VectorManifestRow>,
  modelKey: string,
  opts: { force?: boolean; now?: number; pruneStale?: boolean } = {},
): VectorIndexPlan {
  const now = opts.now ?? Date.now();
  const currentIds = new Set(docs.map((doc) => doc.id));
  const staleIds = opts.pruneStale === false ? [] : [...previous.keys()].filter((chunkId) => !currentIds.has(chunkId));
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

export function writeVectorIndexManifest(input: OracleDbInput, plan: VectorIndexPlan): boolean {
  const db = asOracleDb(input);
  try {
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
    return true;
  } catch (error) {
    if (isMissingManifestTable(error)) return false;
    throw error;
  }
}

export async function applyVectorIndexPlan(
  store: VectorStoreAdapter,
  plan: VectorIndexPlan,
  opts: VectorIndexApplyOptions = {},
): Promise<VectorIndexApplyResult> {
  if (opts.replaceBaseline !== true && plan.changedDocs.length === 0 && plan.staleIds.length === 0) {
    return { embedded: 0, deleted: 0, replaced: false, aborted: false };
  }
  const mustReplace = opts.replaceBaseline === true
    || ((plan.changedDocs.length > 0 || plan.staleIds.length > 0) && !store.deleteDocuments);
  if (mustReplace) {
    if (store.replaceDocuments) {
      return replaceBatches(store, plan, opts);
    }
    await store.deleteCollection();
    await store.ensureCollection();
    return addBatches(store, plan.docs, plan, { ...opts, action: 'replaced', replaced: true });
  }

  const deleteIds = [...plan.staleIds, ...plan.changedDocs.map((doc) => doc.id)];
  if (deleteIds.length > 0) await store.deleteDocuments?.(deleteIds);
  return addBatches(store, plan.changedDocs, plan, { ...opts, action: 'embedded', replaced: false });
}

async function replaceBatches(
  store: VectorStoreAdapter,
  plan: VectorIndexPlan,
  opts: VectorIndexApplyOptions,
): Promise<VectorIndexApplyResult> {
  if (opts.shouldAbort?.()) return result(0, plan, true, true);
  if (plan.docs.length === 0) {
    await store.replaceDocuments?.([]);
    opts.onProgress?.(0, plan.total, 'replaced');
    return result(0, plan, true, false);
  }
  const batchSize = Math.max(1, Math.trunc(opts.batchSize ?? 100));
  let embedded = 0;
  for (let i = 0; i < plan.docs.length; i += batchSize) {
    if (opts.shouldAbort?.()) return result(embedded, plan, true, true);
    const batch = plan.docs.slice(i, i + batchSize);
    if (i === 0) await store.replaceDocuments?.(batch);
    else await store.addDocuments(batch);
    embedded += batch.length;
    opts.onProgress?.(embedded, plan.total, 'replaced');
  }
  return result(embedded, plan, true, false);
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

async function addBatches(
  store: VectorStoreAdapter,
  docs: VectorDocument[],
  plan: VectorIndexPlan,
  opts: VectorIndexApplyOptions & { action: 'embedded' | 'replaced'; replaced: boolean },
): Promise<VectorIndexApplyResult> {
  const batchSize = Math.max(1, Math.trunc(opts.batchSize ?? 100));
  let embedded = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    if (opts.shouldAbort?.()) return result(embedded, plan, opts.replaced, true);
    const batch = docs.slice(i, i + batchSize);
    await store.addDocuments(batch);
    embedded += batch.length;
    opts.onProgress?.(embedded, plan.total, opts.action);
  }
  return result(embedded, plan, opts.replaced, false);
}

function result(embedded: number, plan: VectorIndexPlan, replaced: boolean, aborted: boolean): VectorIndexApplyResult {
  return { embedded, deleted: plan.staleIds.length, replaced, aborted };
}

function isMissingManifestTable(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes('vector_index_manifest');
}
