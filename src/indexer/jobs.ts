/**
 * Durable, hash-keyed queue for incremental vector indexing.
 *
 * SQLite owns delivery state. A logical vector job is unique by
 * (model_key, doc_id, content_hash, operation), so repeated scanners and
 * concurrent producers cannot enqueue the same canonical payload twice.
 */

import type Database from 'bun:sqlite';
import { and, asc, count, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { indexingJobs, vectorIndexManifest } from '../db/schema.ts';
import { vectorManifestId } from './vector-index-manifest.ts';

export type VectorOperation = 'upsert' | 'delete';

export interface EnqueueOptions {
  docId: string;
  /** SHA-256 for the canonical text + metadata payload. */
  contentHash?: string;
  operation?: VectorOperation;
  /** If omitted, enqueue once per registered model. */
  modelKey?: string;
  /** Registry of model_key → collection. */
  models: Record<string, { collection: string }>;
  /** Explicit maintenance mode: reactivate a terminal matching job for a durable re-upsert. */
  force?: boolean;
}

export interface EnqueuedJob {
  id: string;
  docId: string;
  modelKey: string;
  collection: string;
  contentHash: string;
  operation: VectorOperation;
}

export interface IndexedVectorJob extends EnqueuedJob {
  sourceFile: string;
}

const RANDOM_SUFFIX_LENGTH = 6;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
type JobsDb = Database | BunSQLiteDatabase<typeof schema>;

function jobId(modelKey: string): string {
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
 * Insert jobs idempotently. `manual:<docId>` is intentionally only a fallback
 * for the operator CLI; production reconciliations always pass a real hash.
 */
export function enqueueIndexJob(conn: JobsDb, opts: EnqueueOptions): EnqueuedJob[] {
  const targets: Array<{ key: string; collection: string }> = opts.modelKey
    ? opts.models[opts.modelKey]
      ? [{ key: opts.modelKey, collection: opts.models[opts.modelKey].collection }]
      : []
    : Object.entries(opts.models).map(([key, { collection }]) => ({ key, collection }));
  if (targets.length === 0) return [];

  const db = asDrizzle(conn);
  const contentHash = opts.contentHash ?? `manual:${opts.docId}`;
  const operation = opts.operation ?? 'upsert';
  const out: EnqueuedJob[] = [];

  for (const { key, collection } of targets) {
    const values = {
      id: jobId(key),
      docId: opts.docId,
      modelKey: key,
      collection,
      contentHash,
      operation,
      status: 'pending' as const,
      attempts: 0,
    };
    const target = [indexingJobs.modelKey, indexingJobs.docId, indexingJobs.contentHash, indexingJobs.operation];
    const inserted = opts.force
      ? db.insert(indexingJobs)
        .values(values)
        .onConflictDoUpdate({
          target,
          set: { status: 'pending', attempts: 0, claimedAt: null, leaseExpiresAt: null, finishedAt: null, error: null },
        })
        .returning({
          id: indexingJobs.id,
          docId: indexingJobs.docId,
          modelKey: indexingJobs.modelKey,
          collection: indexingJobs.collection,
          contentHash: indexingJobs.contentHash,
          operation: indexingJobs.operation,
        })
        .get()
      : db.insert(indexingJobs)
        .values(values)
        .onConflictDoNothing({ target })
        .returning({
          id: indexingJobs.id,
          docId: indexingJobs.docId,
          modelKey: indexingJobs.modelKey,
          collection: indexingJobs.collection,
          contentHash: indexingJobs.contentHash,
          operation: indexingJobs.operation,
        })
        .get();
    if (inserted) out.push({ ...inserted, operation: inserted.operation as VectorOperation });
  }
  return out;
}

/** Atomically claim one pending job and issue a finite crash-recovery lease. */
export function claimNextJob(
  conn: JobsDb,
  modelKey: string,
  opts: { now?: number; leaseMs?: number } = {},
): EnqueuedJob | null {
  const db = asDrizzle(conn);
  const now = opts.now ?? Date.now();
  const leaseExpiresAt = now + (opts.leaseMs ?? DEFAULT_LEASE_MS);
  const nextPending = db.select({ id: indexingJobs.id })
    .from(indexingJobs)
    .where(and(eq(indexingJobs.status, 'pending'), eq(indexingJobs.modelKey, modelKey)))
    .orderBy(asc(indexingJobs.createdAt))
    .limit(1);

  const row = db.update(indexingJobs)
    .set({
      status: 'claimed',
      claimedAt: now,
      leaseExpiresAt,
      attempts: sql`${indexingJobs.attempts} + 1`,
    })
    .where(inArray(indexingJobs.id, nextPending))
    .returning({
      id: indexingJobs.id,
      docId: indexingJobs.docId,
      modelKey: indexingJobs.modelKey,
      collection: indexingJobs.collection,
      contentHash: indexingJobs.contentHash,
      operation: indexingJobs.operation,
    })
    .get();

  return row ? { ...row, operation: row.operation as VectorOperation } : null;
}

/** Claim a small FIFO batch. Each claim is atomic, so competing daemons cannot
 * receive the same job; batching only changes work scheduling, not delivery semantics. */
export function claimNextJobs(conn: JobsDb, modelKey: string, batchSize: number): EnqueuedJob[] {
  const jobs: EnqueuedJob[] = [];
  const size = Math.max(1, Math.trunc(batchSize));
  for (let i = 0; i < size; i++) {
    const job = claimNextJob(conn, modelKey);
    if (!job) break;
    jobs.push(job);
  }
  return jobs;
}

export function markJobDone(conn: JobsDb, id: string): void {
  const db = asDrizzle(conn);
  db.update(indexingJobs)
    .set({ status: 'done', finishedAt: Date.now(), error: null, leaseExpiresAt: null })
    .where(eq(indexingJobs.id, id))
    .run();
}

/**
 * Commit the durable completion receipt only after LanceDB accepted the row.
 * If the process dies after LanceDB but before this transaction, retrying the
 * same stable id is harmless because the vector adapter performs an upsert.
 */
export function markJobDoneAndManifest(conn: JobsDb, job: IndexedVectorJob): void {
  const db = asDrizzle(conn);
  const now = Date.now();
  db.transaction((tx) => {
    tx.insert(vectorIndexManifest)
      .values({
        id: vectorManifestId(job.modelKey, job.docId),
        chunkId: job.docId,
        sourceFile: job.sourceFile,
        modelKey: job.modelKey,
        contentHash: job.contentHash,
        updatedAt: now,
        indexedAt: now,
      })
      .onConflictDoUpdate({
        target: vectorIndexManifest.id,
        set: {
          chunkId: job.docId,
          sourceFile: job.sourceFile,
          modelKey: job.modelKey,
          contentHash: job.contentHash,
          updatedAt: now,
          indexedAt: now,
        },
      })
      .run();
    tx.update(indexingJobs)
      .set({ status: 'done', finishedAt: now, error: null, leaseExpiresAt: null })
      .where(eq(indexingJobs.id, job.id))
      .run();
  });
}

/** Complete a homogeneous batch after its LanceDB write succeeded. */
export function markJobsDoneAndManifest(conn: JobsDb, jobs: IndexedVectorJob[]): void {
  if (jobs.length === 0) return;
  const db = asDrizzle(conn);
  const now = Date.now();
  db.transaction((tx) => {
    for (const job of jobs) {
      if (job.operation === 'delete') {
        tx.delete(vectorIndexManifest).where(eq(vectorIndexManifest.id, vectorManifestId(job.modelKey, job.docId))).run();
      } else {
        tx.insert(vectorIndexManifest).values({
          id: vectorManifestId(job.modelKey, job.docId), chunkId: job.docId, sourceFile: job.sourceFile,
          modelKey: job.modelKey, contentHash: job.contentHash, updatedAt: now, indexedAt: now,
        }).onConflictDoUpdate({ target: vectorIndexManifest.id, set: {
          chunkId: job.docId, sourceFile: job.sourceFile, modelKey: job.modelKey, contentHash: job.contentHash, updatedAt: now, indexedAt: now,
        } }).run();
      }
    }
    tx.update(indexingJobs).set({ status: 'done', finishedAt: now, error: null, leaseExpiresAt: null })
      .where(inArray(indexingJobs.id, jobs.map((job) => job.id))).run();
  });
}

export function markJobError(conn: JobsDb, id: string, error: string): void {
  const db = asDrizzle(conn);
  db.update(indexingJobs)
    .set({ status: 'error', finishedAt: Date.now(), error, leaseExpiresAt: null })
    .where(eq(indexingJobs.id, id))
    .run();
}

/** Return expired claims to pending on daemon start; terminal states are never changed. */
export function reclaimExpiredJobs(conn: JobsDb, now = Date.now()): number {
  const db = asDrizzle(conn);
  const expiredWhere = and(
    eq(indexingJobs.status, 'claimed'),
    or(lt(indexingJobs.leaseExpiresAt, now), sql`${indexingJobs.leaseExpiresAt} IS NULL`),
  );
  const expired = db.select({ total: count() }).from(indexingJobs).where(expiredWhere).get()?.total ?? 0;
  if (expired === 0) return 0;
  db.update(indexingJobs)
    .set({ status: 'pending', claimedAt: null, leaseExpiresAt: null })
    .where(expiredWhere)
    .run();
  return expired;
}

/** Reset one claimed job for focused recovery/testing. */
export function reclaimStaleJob(conn: JobsDb, id: string): void {
  const db = asDrizzle(conn);
  db.update(indexingJobs)
    .set({ status: 'pending', claimedAt: null, leaseExpiresAt: null })
    .where(and(eq(indexingJobs.id, id), eq(indexingJobs.status, 'claimed')))
    .run();
}

export function jobsByStatus(
  conn: JobsDb,
  modelKey?: string,
): Array<{ status: string; model_key: string; count: number }> {
  const db = asDrizzle(conn);
  const where = modelKey ? eq(indexingJobs.modelKey, modelKey) : undefined;
  const rows = db.select({ status: indexingJobs.status, modelKey: indexingJobs.modelKey, count: count() })
    .from(indexingJobs)
    .where(where)
    .groupBy(indexingJobs.status, indexingJobs.modelKey)
    .orderBy(modelKey ? asc(indexingJobs.status) : asc(indexingJobs.modelKey), asc(indexingJobs.status))
    .all();
  return rows.map((row) => ({ status: row.status, model_key: row.modelKey, count: row.count }));
}
