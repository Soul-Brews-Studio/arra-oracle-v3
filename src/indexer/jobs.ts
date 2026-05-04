/**
 * Indexer job-queue helpers — M1 of the indexer-CLI design.
 *
 * Synchronous SQLite operations against the `indexing_jobs` table. No
 * embedding, no Ollama, no LanceDB. Just queue plumbing — the daemon
 * (M2) is what does the actual work.
 *
 * Plug-and-play invariants:
 *   - One row per (doc_id, model_key) — adding a model adds queue entries,
 *     never touches oracle_documents or other models' collections
 *   - claimNextJob() is atomic via UPDATE...RETURNING with WHERE status filter
 *   - markJobError() preserves the row (no destruction); attempts increments
 *
 * Design rationale: ψ/lab/indexer-cli/DESIGN.md in arra-mcp-installation-guide-oracle
 */

import type Database from 'bun:sqlite';

export interface EnqueueOptions {
  docId: string;
  /** If omitted → enqueue for ALL models in the registry (typical arra_learn case). */
  modelKey?: string;
  /** Registry of model_key → collection. Caller passes this in (no global state). */
  models: Record<string, { collection: string }>;
}

export interface EnqueuedJob {
  id: string;
  docId: string;
  modelKey: string;
  collection: string;
}

const RANDOM_SUFFIX_LENGTH = 6;

function jobId(modelKey: string): string {
  // "idx-<ms>-<modelKey>-<rand>" — short, sortable, unique enough for our scale.
  const safe = modelKey.replace(/[^a-z0-9]/gi, '');
  const rand = Math.random().toString(36).slice(2, 2 + RANDOM_SUFFIX_LENGTH);
  return `idx-${Date.now()}-${safe}-${rand}`;
}

/**
 * Insert one or more job rows. Returns the rows that were inserted.
 *
 * For unset `modelKey`, inserts one row per entry in `models`. For a specified
 * `modelKey` not in `models`, returns [] (nothing to enqueue — caller's choice
 * to fail loudly or silently).
 */
export function enqueueIndexJob(db: Database, opts: EnqueueOptions): EnqueuedJob[] {
  const targets: Array<{ key: string; collection: string }> = opts.modelKey
    ? opts.models[opts.modelKey]
      ? [{ key: opts.modelKey, collection: opts.models[opts.modelKey].collection }]
      : []
    : Object.entries(opts.models).map(([key, { collection }]) => ({ key, collection }));

  if (targets.length === 0) return [];

  const stmt = db.prepare(
    `INSERT INTO indexing_jobs (id, doc_id, model_key, collection, status, attempts)
     VALUES (?, ?, ?, ?, 'pending', 0)`,
  );

  const out: EnqueuedJob[] = [];
  for (const { key, collection } of targets) {
    const id = jobId(key);
    stmt.run(id, opts.docId, key, collection);
    out.push({ id, docId: opts.docId, modelKey: key, collection });
  }
  return out;
}

/**
 * Atomically claim the next pending job for a worker.
 * Uses UPDATE…RETURNING so SQLite gives us exactly one row even under
 * concurrent claimers (only one wins per row).
 *
 * Returns null when the queue is empty for that model.
 */
export function claimNextJob(db: Database, modelKey: string): EnqueuedJob | null {
  // SQLite supports UPDATE … RETURNING since 3.35. Bun ships a new-enough sqlite.
  const row = db
    .query<
      {
        id: string;
        doc_id: string;
        model_key: string;
        collection: string;
      },
      [string]
    >(
      `UPDATE indexing_jobs
       SET status = 'claimed', claimed_at = (strftime('%s','now')*1000), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM indexing_jobs
         WHERE status = 'pending' AND model_key = ?
         ORDER BY created_at ASC
         LIMIT 1
       )
       RETURNING id, doc_id, model_key, collection`,
    )
    .get(modelKey);

  if (!row) return null;
  return { id: row.id, docId: row.doc_id, modelKey: row.model_key, collection: row.collection };
}

export function markJobDone(db: Database, id: string): void {
  db.prepare(
    `UPDATE indexing_jobs
     SET status = 'done', finished_at = (strftime('%s','now')*1000), error = NULL
     WHERE id = ?`,
  ).run(id);
}

export function markJobError(db: Database, id: string, error: string): void {
  // Preserve the row, set status, store the error string. Attempts already
  // incremented at claim time — caller decides retry policy.
  db.prepare(
    `UPDATE indexing_jobs
     SET status = 'error', finished_at = (strftime('%s','now')*1000), error = ?
     WHERE id = ?`,
  ).run(error, id);
}

/** Reset a stuck `claimed` job back to `pending` — for daemon-crash recovery. */
export function reclaimStaleJob(db: Database, id: string): void {
  db.prepare(
    `UPDATE indexing_jobs
     SET status = 'pending', claimed_at = NULL
     WHERE id = ? AND status = 'claimed'`,
  ).run(id);
}

export function jobsByStatus(
  db: Database,
  modelKey?: string,
): Array<{ status: string; model_key: string; count: number }> {
  if (modelKey) {
    return db
      .query<{ status: string; model_key: string; count: number }, [string]>(
        `SELECT status, model_key, COUNT(*) as count FROM indexing_jobs
         WHERE model_key = ?
         GROUP BY status, model_key
         ORDER BY status`,
      )
      .all(modelKey);
  }
  return db
    .query<{ status: string; model_key: string; count: number }, []>(
      `SELECT status, model_key, COUNT(*) as count FROM indexing_jobs
       GROUP BY status, model_key
       ORDER BY model_key, status`,
    )
    .all();
}
