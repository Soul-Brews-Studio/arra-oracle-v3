/**
 * Indexer job-queue helpers — M1 of the indexer-CLI design.
 *
 * Synchronous Drizzle operations against the `indexing_jobs` table. No
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
import { and, asc, count, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { indexingJobs } from '../db/schema.ts';

export interface EnqueueOptions {
  docId: string;
  /** If omitted → enqueue for ALL models in the registry (typical oracle_learn case). */
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
type JobsDb = Database | BunSQLiteDatabase<typeof schema>;

function jobId(modelKey: string): string {
  // "idx-<ms>-<modelKey>-<rand>" — short, sortable, unique enough for our scale.
  const safe = modelKey.replace(/[^a-z0-9]/gi, '');
  const rand = Math.random().toString(36).slice(2, 2 + RANDOM_SUFFIX_LENGTH);
  return `idx-${Date.now()}-${safe}-${rand}`;
}

function asDrizzle(conn: JobsDb): BunSQLiteDatabase<typeof schema> {
  if ('select' in conn && typeof conn.select === 'function') {
    return conn as BunSQLiteDatabase<typeof schema>;
  }
  return drizzle(conn as Database, { schema });
}

/**
 * Insert one or more job rows. Returns the rows that were inserted.
 *
 * For unset `modelKey`, inserts one row per entry in `models`. For a specified
 * `modelKey` not in `models`, returns [] (nothing to enqueue — caller's choice
 * to fail loudly or silently).
 */
export function enqueueIndexJob(conn: JobsDb, opts: EnqueueOptions): EnqueuedJob[] {
  const targets: Array<{ key: string; collection: string }> = opts.modelKey
    ? opts.models[opts.modelKey]
      ? [{ key: opts.modelKey, collection: opts.models[opts.modelKey].collection }]
      : []
    : Object.entries(opts.models).map(([key, { collection }]) => ({ key, collection }));

  if (targets.length === 0) return [];

  const db = asDrizzle(conn);

  const out: EnqueuedJob[] = [];
  for (const { key, collection } of targets) {
    const id = jobId(key);
    db.insert(indexingJobs).values({
      id,
      docId: opts.docId,
      modelKey: key,
      collection,
      status: 'pending',
      attempts: 0,
    }).run();
    out.push({ id, docId: opts.docId, modelKey: key, collection });
  }
  return out;
}

/** Lease length: a `claimed` job older than this is assumed orphaned (worker died). */
export const LEASE_MS = 10 * 60_000;
/** Retry delay after the Nth failed attempt = BACKOFF_BASE_MS * 2^(N-1), capped. */
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
/** After this many attempts an `error` row is final (dead) and never re-claimed. */
export const MAX_ATTEMPTS = 5;
/** Error string written by the CLI cancel path (arra-indexer.ts); such rows are never retried. */
const CANCELLED = 'cancelled by CLI';

export interface ClaimedJob extends EnqueuedJob {
  /** Lease token — pass back to markJobDone/markJobError so a stale worker can't overwrite. */
  claimedAt: number;
  attempts: number;
}

/**
 * Atomically claim the next runnable job for a worker. Runnable =
 *   - `pending`, or
 *   - `claimed` whose lease expired (worker crashed) and attempts < MAX, or
 *   - `error` whose backoff elapsed and attempts < MAX (not CLI-cancelled).
 * Uses UPDATE…RETURNING so SQLite gives us exactly one row even under
 * concurrent claimers (only one wins per row).
 * ponytail: no schema change — lease = claimed_at, backoff clock = finished_at.
 * Ceiling: an expired claim already at MAX stays `claimed`; add a dead-sweep if it shows up.
 *
 * Returns null when nothing is runnable for that model.
 */
export function claimNextJob(
  conn: JobsDb,
  modelKey: string,
  now: number = Date.now(),
): ClaimedJob | null {
  const db = asDrizzle(conn);
  const runnable = or(
    eq(indexingJobs.status, 'pending'),
    and(
      eq(indexingJobs.status, 'claimed'),
      lte(indexingJobs.claimedAt, now - LEASE_MS),
      lt(indexingJobs.attempts, MAX_ATTEMPTS),
    ),
    and(
      eq(indexingJobs.status, 'error'),
      gte(indexingJobs.attempts, 1),
      lt(indexingJobs.attempts, MAX_ATTEMPTS),
      ne(sql`coalesce(${indexingJobs.error}, '')`, CANCELLED),
      sql`${indexingJobs.finishedAt} + min(${BACKOFF_BASE_MS} * (1 << (${indexingJobs.attempts} - 1)), ${BACKOFF_MAX_MS}) <= ${now}`,
    ),
  );
  const next = db.select({ id: indexingJobs.id })
    .from(indexingJobs)
    .where(and(eq(indexingJobs.modelKey, modelKey), runnable))
    .orderBy(asc(indexingJobs.createdAt))
    .limit(1);

  const row = db.update(indexingJobs)
    .set({
      status: 'claimed',
      claimedAt: now,
      attempts: sql`${indexingJobs.attempts} + 1`,
    })
    .where(inArray(indexingJobs.id, next))
    .returning({
      id: indexingJobs.id,
      docId: indexingJobs.docId,
      modelKey: indexingJobs.modelKey,
      collection: indexingJobs.collection,
      claimedAt: indexingJobs.claimedAt,
      attempts: indexingJobs.attempts,
    })
    .get();

  if (!row || row.claimedAt === null) return null;
  return { ...row, claimedAt: row.claimedAt };
}

/** Returns false when the lease was lost (another worker re-claimed) — the write is skipped. */
export function markJobDone(conn: JobsDb, id: string, claimedAt?: number): boolean {
  return finish(conn, id, claimedAt, { status: 'done', error: null });
}

/**
 * Preserve the row, store the error. Retry is implicit: claimNextJob picks it up
 * again after backoff until attempts hits MAX_ATTEMPTS (then it's dead).
 */
export function markJobError(conn: JobsDb, id: string, error: string, claimedAt?: number): boolean {
  return finish(conn, id, claimedAt, { status: 'error', error });
}

function finish(
  conn: JobsDb,
  id: string,
  claimedAt: number | undefined,
  set: { status: string; error: string | null },
): boolean {
  const db = asDrizzle(conn);
  const guard = claimedAt === undefined
    ? eq(indexingJobs.id, id)
    : and(eq(indexingJobs.id, id), eq(indexingJobs.status, 'claimed'), eq(indexingJobs.claimedAt, claimedAt));
  return db.update(indexingJobs)
    .set({ ...set, finishedAt: Date.now() })
    .where(guard)
    .returning({ id: indexingJobs.id })
    .all().length > 0;
}

/** Reset a stuck `claimed` job back to `pending` — for daemon-crash recovery. */
export function reclaimStaleJob(conn: JobsDb, id: string): void {
  const db = asDrizzle(conn);
  db.update(indexingJobs)
    .set({ status: 'pending', claimedAt: null })
    .where(and(eq(indexingJobs.id, id), eq(indexingJobs.status, 'claimed')))
    .run();
}

export function jobsByStatus(
  conn: JobsDb,
  modelKey?: string,
): Array<{ status: string; model_key: string; count: number }> {
  const db = asDrizzle(conn);
  const where = modelKey ? eq(indexingJobs.modelKey, modelKey) : undefined;
  const rows = db.select({
    status: indexingJobs.status,
    modelKey: indexingJobs.modelKey,
    count: count(),
  })
    .from(indexingJobs)
    .where(where)
    .groupBy(indexingJobs.status, indexingJobs.modelKey)
    .orderBy(modelKey ? asc(indexingJobs.status) : asc(indexingJobs.modelKey), asc(indexingJobs.status))
    .all();

  return rows.map((row) => ({
    status: row.status,
    model_key: row.modelKey,
    count: row.count,
  }));
}
