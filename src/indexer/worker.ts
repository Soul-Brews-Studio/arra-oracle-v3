/**
 * Indexer worker loop — M2 of the indexer-CLI design.
 *
 * One worker per registered model. Pulls pending jobs from `indexing_jobs`,
 * embeds via the supplied `embed()` function, writes to LanceDB via
 * `upsertVector()`, and marks the job done. On error, calls `markJobError`
 * (the row is preserved with the error message — caller decides retry policy).
 *
 * The worker is dependency-injected — no global state, no direct imports of
 * Ollama or LanceDB in this file. That keeps it unit-testable with mocks
 * and lets M3 (HTTP daemon) and M4 (CLI) wire the real adapters.
 *
 * Plug-and-play invariant honored: the worker only operates on its own
 * `model_key` queue; cross-model state (other collections, other doc rows)
 * is never touched.
 *
 * Design: ψ/lab/indexer-cli/DESIGN.md (M2).
 */

import type Database from 'bun:sqlite';
import {
  claimNextJob,
  markJobDone,
  markJobError,
  type EnqueuedJob,
} from './jobs.ts';

export interface WorkerDeps {
  db: Database;
  /**
   * Resolve the document text from oracle.db. Returns null if the doc was
   * deleted between enqueue and claim — the worker will mark the job done
   * (no-op embed) per design (FTS-first/vector-later survives doc deletion).
   */
  getDocText: (docId: string) => string | null;
  /** Embed text for `modelKey`. Throws on Ollama errors → marks job error. */
  embed: (modelKey: string, text: string) => Promise<number[]>;
  /** Upsert into the model's LanceDB collection. Throws → marks job error. */
  upsertVector: (collection: string, docId: string, vector: number[]) => Promise<void>;
  /** Returns true when the worker should exit cleanly. Caller wires SIGTERM/SIGINT. */
  isShuttingDown: () => boolean;
  /** Sleep between empty-queue polls (default 1000ms). */
  pollIntervalMs?: number;
  /** Optional event hook — called on every state change. Used by M3 SSE. */
  onEvent?: (ev: WorkerEvent) => void;
}

export type WorkerEvent =
  | { type: 'claimed'; job: EnqueuedJob }
  | { type: 'done'; job: EnqueuedJob; durationMs: number }
  | { type: 'error'; job: EnqueuedJob; error: string }
  | { type: 'doc_missing'; job: EnqueuedJob }
  | { type: 'idle'; modelKey: string };

export interface WorkerStats {
  modelKey: string;
  processed: number;     // markJobDone count (incl. doc_missing no-ops)
  errors: number;
  emptyPolls: number;
}

const DEFAULT_POLL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a worker loop for a single model. Returns when `isShuttingDown()` is true.
 *
 * Caller is responsible for:
 *   - Spawning one runWorker() call per registered model (no shared state)
 *   - Plumbing real Ollama (embed) + LanceDB (upsertVector) through the deps
 *   - Setting `isShuttingDown` on signal handlers
 *
 * The function is deliberately not async-iterable — keep it as a flat loop so
 * shutdown is testable with a deterministic flag flip.
 */
export async function runWorker(
  modelKey: string,
  deps: WorkerDeps,
): Promise<WorkerStats> {
  const stats: WorkerStats = { modelKey, processed: 0, errors: 0, emptyPolls: 0 };
  const pollMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;

  while (!deps.isShuttingDown()) {
    const job = claimNextJob(deps.db, modelKey);
    if (!job) {
      stats.emptyPolls++;
      deps.onEvent?.({ type: 'idle', modelKey });
      await sleep(pollMs);
      continue;
    }

    deps.onEvent?.({ type: 'claimed', job });

    try {
      const text = deps.getDocText(job.docId);
      if (text === null) {
        // Doc was deleted between enqueue and claim — mark done (no-op).
        // Plug-play: removing a doc from oracle_documents leaves queue rows
        // safely consumable. The worker absorbs the no-op gracefully.
        markJobDone(deps.db, job.id);
        deps.onEvent?.({ type: 'doc_missing', job });
        stats.processed++;
        continue;
      }

      const t0 = performance.now();
      const vector = await deps.embed(job.modelKey, text);
      await deps.upsertVector(job.collection, job.docId, vector);
      markJobDone(deps.db, job.id);
      stats.processed++;
      deps.onEvent?.({
        type: 'done',
        job,
        durationMs: Math.round(performance.now() - t0),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markJobError(deps.db, job.id, msg);
      stats.errors++;
      deps.onEvent?.({ type: 'error', job, error: msg });
    }
  }

  return stats;
}
