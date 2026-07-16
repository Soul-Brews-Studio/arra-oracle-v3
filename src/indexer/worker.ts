import type Database from 'bun:sqlite';
import type { VectorDocument } from '../vector/types.ts';
import { claimNextJob, claimNextJobs, markJobDone, markJobError, type EnqueuedJob, type IndexedVectorJob } from './jobs.ts';

export interface WorkerDeps {
  db: Database;
  getDocument: (docId: string) => VectorDocument | null;
  embed: (modelKey: string, text: string) => Promise<number[]>;
  upsertVector: (collection: string, document: VectorDocument, vector: number[]) => Promise<void>;
  commitSuccess?: (job: EnqueuedJob, document: VectorDocument) => void;
  isShuttingDown: () => boolean;
  pollIntervalMs?: number;
  onEvent?: (ev: WorkerEvent) => void;
}
export type WorkerEvent =
  | { type: 'claimed'; job: EnqueuedJob }
  | { type: 'done'; job: EnqueuedJob; durationMs: number }
  | { type: 'error'; job: EnqueuedJob; error: string }
  | { type: 'doc_missing'; job: EnqueuedJob }
  | { type: 'stale_payload'; job: EnqueuedJob }
  | { type: 'idle'; modelKey: string };
export interface WorkerStats { modelKey: string; processed: number; errors: number; emptyPolls: number }
const DEFAULT_POLL_MS = 1000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function emit(deps: WorkerDeps, ev: WorkerEvent): void { try { deps.onEvent?.(ev); } catch {} }

export async function runWorker(modelKey: string, deps: WorkerDeps): Promise<WorkerStats> {
  const stats: WorkerStats = { modelKey, processed: 0, errors: 0, emptyPolls: 0 };
  while (!deps.isShuttingDown()) {
    const job = claimNextJob(deps.db, modelKey);
    if (!job) { stats.emptyPolls++; emit(deps, { type: 'idle', modelKey }); await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_MS); continue; }
    emit(deps, { type: 'claimed', job });
    try {
      const document = deps.getDocument(job.docId);
      if (!document) { markJobDone(deps.db, job.id); emit(deps, { type: 'doc_missing', job }); stats.processed++; continue; }
      const { vectorContentHash } = await import('./vector-index-manifest.ts');
      if (!job.contentHash.startsWith('manual:') && vectorContentHash(document) !== job.contentHash) { markJobDone(deps.db, job.id); emit(deps, { type: 'stale_payload', job }); stats.processed++; continue; }
      const started = performance.now();
      const vector = await deps.embed(job.modelKey, document.document);
      await deps.upsertVector(job.collection, document, vector);
      if (deps.commitSuccess) deps.commitSuccess(job, document); else markJobDone(deps.db, job.id);
      stats.processed++; emit(deps, { type: 'done', job, durationMs: Math.round(performance.now() - started) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markJobError(deps.db, job.id, message); stats.errors++; emit(deps, { type: 'error', job, error: message });
    }
  }
  return stats;
}

export interface BatchWorkerDeps {
  db: Database;
  getDocument: (docId: string) => VectorDocument | null;
  embedBatch: (modelKey: string, texts: string[]) => Promise<number[][]>;
  upsertVectors: (collection: string, documents: VectorDocument[]) => Promise<void>;
  deleteVectors: (collection: string, ids: string[]) => Promise<void>;
  commitSuccess: (jobs: IndexedVectorJob[]) => void;
  isShuttingDown: () => boolean;
  batchSize?: number;
  pollIntervalMs?: number;
  onEvent?: (ev: WorkerEvent) => void;
}

/** Batch daemon worker: one embedding call and one LanceDB merge/delete per job kind. */
export async function runBatchWorker(modelKey: string, deps: BatchWorkerDeps): Promise<WorkerStats> {
  const stats: WorkerStats = { modelKey, processed: 0, errors: 0, emptyPolls: 0 };
  while (!deps.isShuttingDown()) {
    const jobs = claimNextJobs(deps.db, modelKey, deps.batchSize ?? 16);
    if (jobs.length === 0) { stats.emptyPolls++; emit(deps as unknown as WorkerDeps, { type: 'idle', modelKey }); await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_MS); continue; }
    jobs.forEach((job) => emit(deps as unknown as WorkerDeps, { type: 'claimed', job }));
    const deletes = jobs.filter((job) => job.operation === 'delete');
    if (deletes.length > 0) {
      try { await deps.deleteVectors(deletes[0].collection, deletes.map((job) => job.docId)); deps.commitSuccess(deletes.map((job) => ({ ...job, sourceFile: '' }))); stats.processed += deletes.length; deletes.forEach((job) => emit(deps as unknown as WorkerDeps, { type: 'done', job, durationMs: 0 })); }
      catch (error) { const message = error instanceof Error ? error.message : String(error); deletes.forEach((job) => { markJobError(deps.db, job.id, message); emit(deps as unknown as WorkerDeps, { type: 'error', job, error: message }); }); stats.errors += deletes.length; }
    }
    const candidates: Array<{ job: EnqueuedJob; document: VectorDocument }> = [];
    const { vectorContentHash } = await import('./vector-index-manifest.ts');
    for (const job of jobs.filter((job) => job.operation === 'upsert')) {
      const document = deps.getDocument(job.docId);
      if (!document) { markJobDone(deps.db, job.id); stats.processed++; emit(deps as unknown as WorkerDeps, { type: 'doc_missing', job }); continue; }
      if (!job.contentHash.startsWith('manual:') && vectorContentHash(document) !== job.contentHash) { markJobDone(deps.db, job.id); stats.processed++; emit(deps as unknown as WorkerDeps, { type: 'stale_payload', job }); continue; }
      candidates.push({ job, document });
    }
    if (candidates.length === 0) continue;
    try {
      const vectors = await deps.embedBatch(modelKey, candidates.map(({ document }) => document.document));
      if (vectors.length !== candidates.length) throw new Error(`Embedding batch cardinality mismatch: ${vectors.length}/${candidates.length}`);
      const docs = candidates.map(({ document }, i) => ({ ...document, vector: vectors[i] }));
      await deps.upsertVectors(candidates[0].job.collection, docs);
      const completed = candidates.map(({ job, document }) => ({ ...job, sourceFile: String(document.metadata.source_file ?? '') }));
      deps.commitSuccess(completed); stats.processed += completed.length;
      completed.forEach((job) => emit(deps as unknown as WorkerDeps, { type: 'done', job, durationMs: 0 }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      candidates.forEach(({ job }) => { markJobError(deps.db, job.id, message); emit(deps as unknown as WorkerDeps, { type: 'error', job, error: message }); }); stats.errors += candidates.length;
    }
  }
  return stats;
}
