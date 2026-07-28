/**
 * M1 indexer-CLI tests — table + helpers, no daemon yet.
 * Uses an in-memory SQLite for hermetic tests.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import Database from 'bun:sqlite';
import {
  enqueueIndexJob,
  claimNextJob,
  markJobDone,
  markJobError,
  reclaimStaleJob,
  jobsByStatus,
} from '../jobs.ts';

const MIGRATION_SQL = `
CREATE TABLE indexing_jobs (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  model_key TEXT NOT NULL,
  collection TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
  claimed_at INTEGER,
  finished_at INTEGER,
  error TEXT
);
CREATE INDEX idx_indexing_jobs_pending ON indexing_jobs(status, model_key, created_at)
  WHERE status IN ('pending','claimed');
`;

const MODELS = {
  'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
  qwen3: { collection: 'oracle_knowledge_qwen3' },
  nomic: { collection: 'oracle_knowledge' },
};

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec(MIGRATION_SQL);
  return db;
}

describe('enqueueIndexJob', () => {
  let db: Database;
  beforeEach(() => { db = freshDb(); });

  it('enqueues one row per registered model when modelKey omitted', () => {
    const jobs = enqueueIndexJob(db, { docId: 'doc-1', models: MODELS });
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.modelKey).sort()).toEqual(['bge-m3', 'nomic', 'qwen3']);
    expect(jobs.every((j) => j.docId === 'doc-1')).toBe(true);
    expect(jobs.find((j) => j.modelKey === 'bge-m3')!.collection).toBe('oracle_knowledge_bge_m3');
  });

  it('enqueues exactly one row when modelKey specified', () => {
    const jobs = enqueueIndexJob(db, { docId: 'doc-1', modelKey: 'bge-m3', models: MODELS });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].modelKey).toBe('bge-m3');
  });

  it('returns empty array for unknown modelKey (no insert)', () => {
    const jobs = enqueueIndexJob(db, { docId: 'doc-1', modelKey: 'nonexistent', models: MODELS });
    expect(jobs).toEqual([]);
    const count = db.query('SELECT COUNT(*) as c FROM indexing_jobs').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('generates unique job ids even across rapid calls for the same doc/model', () => {
    const a = enqueueIndexJob(db, { docId: 'doc-1', modelKey: 'bge-m3', models: MODELS });
    const b = enqueueIndexJob(db, { docId: 'doc-1', modelKey: 'bge-m3', models: MODELS });
    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe('claimNextJob', () => {
  let db: Database;
  beforeEach(() => { db = freshDb(); });

  it('returns null when queue empty for the model', () => {
    expect(claimNextJob(db, 'bge-m3')).toBeNull();
  });

  it('claims the oldest pending job for a model', () => {
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    enqueueIndexJob(db, { docId: 'doc-B', modelKey: 'bge-m3', models: MODELS });
    const first = claimNextJob(db, 'bge-m3');
    expect(first?.docId).toBe('doc-A');
    const second = claimNextJob(db, 'bge-m3');
    expect(second?.docId).toBe('doc-B');
    expect(claimNextJob(db, 'bge-m3')).toBeNull();
  });

  it('does not return jobs of other models', () => {
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'qwen3', models: MODELS });
    const claimed = claimNextJob(db, 'bge-m3');
    expect(claimed?.modelKey).toBe('bge-m3');
    expect(claimNextJob(db, 'bge-m3')).toBeNull();
    expect(claimNextJob(db, 'qwen3')?.modelKey).toBe('qwen3');
  });

  it('increments attempts on claim', () => {
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    const claimed = claimNextJob(db, 'bge-m3');
    const row = db.query('SELECT attempts FROM indexing_jobs WHERE id = ?').get(claimed!.id) as { attempts: number };
    expect(row.attempts).toBe(1);
  });

  it('does not re-claim already-claimed jobs', () => {
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    const first = claimNextJob(db, 'bge-m3');
    expect(first).not.toBeNull();
    const second = claimNextJob(db, 'bge-m3');
    expect(second).toBeNull();  // already claimed, not re-claimed
  });
});

describe('markJobDone', () => {
  let db: Database;
  beforeEach(() => { db = freshDb(); });

  it('sets status to done and finished_at, clears error', () => {
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    const job = claimNextJob(db, 'bge-m3')!;
    markJobDone(db, job.id);
    const row = db.query('SELECT status, finished_at, error FROM indexing_jobs WHERE id = ?').get(job.id) as { status: string; finished_at: number; error: string | null };
    expect(row.status).toBe('done');
    expect(row.finished_at).toBeGreaterThan(0);
    expect(row.error).toBeNull();
  });
});

describe('markJobError', () => {
  let db: Database;
  beforeEach(() => { db = freshDb(); });

  it('preserves row, sets status=error and stores message', () => {
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    const job = claimNextJob(db, 'bge-m3')!;
    markJobError(db, job.id, 'Ollama timeout after 30s');
    const row = db.query('SELECT status, error FROM indexing_jobs WHERE id = ?').get(job.id) as { status: string; error: string };
    expect(row.status).toBe('error');
    expect(row.error).toBe('Ollama timeout after 30s');
  });
});

describe('reclaimStaleJob', () => {
  let db: Database;
  beforeEach(() => { db = freshDb(); });

  it('flips claimed → pending so the queue can re-serve it (daemon crash recovery)', () => {
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    const job = claimNextJob(db, 'bge-m3')!;
    reclaimStaleJob(db, job.id);
    const row = db.query('SELECT status, claimed_at FROM indexing_jobs WHERE id = ?').get(job.id) as { status: string; claimed_at: number | null };
    expect(row.status).toBe('pending');
    expect(row.claimed_at).toBeNull();
  });

  it('is a no-op for done/error jobs (safety: never resurrect terminal states)', () => {
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    const job = claimNextJob(db, 'bge-m3')!;
    markJobDone(db, job.id);
    reclaimStaleJob(db, job.id);
    const row = db.query('SELECT status FROM indexing_jobs WHERE id = ?').get(job.id) as { status: string };
    expect(row.status).toBe('done');
  });
});

describe('jobsByStatus', () => {
  let db: Database;
  beforeEach(() => { db = freshDb(); });

  it('counts pending/claimed/done/error by model', () => {
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });
    enqueueIndexJob(db, { docId: 'doc-B', models: MODELS });

    const job = claimNextJob(db, 'bge-m3')!;
    markJobDone(db, job.id);
    const job2 = claimNextJob(db, 'qwen3')!;
    markJobError(db, job2.id, 'whatever');

    const all = jobsByStatus(db);
    // Each of 3 models has 2 jobs total → some pending, one done/error
    const bgeDone = all.find((r) => r.model_key === 'bge-m3' && r.status === 'done');
    expect(bgeDone?.count).toBe(1);
    const qwen3Error = all.find((r) => r.model_key === 'qwen3' && r.status === 'error');
    expect(qwen3Error?.count).toBe(1);
    const nomicPending = all.find((r) => r.model_key === 'nomic' && r.status === 'pending');
    expect(nomicPending?.count).toBe(2);
  });

  it('filters by modelKey when provided', () => {
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });
    const rows = jobsByStatus(db, 'bge-m3');
    expect(rows.every((r) => r.model_key === 'bge-m3')).toBe(true);
    expect(rows[0].count).toBe(1);
  });
});

describe('plug-and-play invariant — adding a model never disturbs other models', () => {
  it('enqueues for newly-added model on next call without touching prior rows', () => {
    const db = freshDb();
    const initialModels = { 'bge-m3': { collection: 'oracle_knowledge_bge_m3' } };
    enqueueIndexJob(db, { docId: 'doc-A', models: initialModels });

    const initialCount = db.query('SELECT COUNT(*) as c FROM indexing_jobs').get() as { c: number };
    expect(initialCount.c).toBe(1);

    // Now operator adds qwen3 to vector-server.json — simulate by passing larger registry
    const expandedModels = {
      'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
      qwen3: { collection: 'oracle_knowledge_qwen3' },
    };
    enqueueIndexJob(db, { docId: 'doc-B', models: expandedModels });

    // doc-B got 2 rows (one per model), doc-A still has its original 1 row, untouched
    const finalRows = db.query('SELECT doc_id, model_key FROM indexing_jobs ORDER BY doc_id, model_key').all() as Array<{ doc_id: string; model_key: string }>;
    expect(finalRows).toHaveLength(3);
    expect(finalRows[0]).toEqual({ doc_id: 'doc-A', model_key: 'bge-m3' });
    expect(finalRows[1]).toEqual({ doc_id: 'doc-B', model_key: 'bge-m3' });
    expect(finalRows[2]).toEqual({ doc_id: 'doc-B', model_key: 'qwen3' });
  });
});
