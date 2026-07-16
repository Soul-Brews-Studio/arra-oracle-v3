import type Database from 'bun:sqlite';
import type { VectorDocument } from '../vector/types.ts';
import { claimNextJob, markJobDone, markJobError, type EnqueuedJob } from './jobs.ts';

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
