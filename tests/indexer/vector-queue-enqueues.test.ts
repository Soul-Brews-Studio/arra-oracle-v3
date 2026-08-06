/**
 * The indexer must actually queue vector jobs. For a long time it queued **zero**.
 *
 * `hasIndexingJobsTable()` asked SQLite whether `indexing_jobs` exists and compared
 * `row?.name`. Drizzle's `db.get()` with a raw `sql` template returns the row as a
 * **positional array**, so `row.name` was always `undefined`:
 *
 * ```
 * raw sqlite sees table          : true
 * db.get(sql`SELECT name …`)     : ["indexing_jobs"]
 * row?.name === 'indexing_jobs'  : false        ← unconditionally
 * ```
 *
 * `enqueueVectorReindexJobs` therefore short-circuited on every run, reporting
 * "Failed to queue N vector job(s); FTS5 index remains current" and moving on. FTS worked, so
 * search kept returning results and nothing looked broken — while the vector corpus received
 * nothing at all. Paired with #2806, where the daemon stored `embed('')` for whatever did get
 * through, the pipeline was broken at both ends.
 *
 * The `<{ name: string }>` type argument on `db.get` asserted a shape that never existed at
 * runtime. A generic is an assertion, not a check, so `tsc` had nothing to catch — which is
 * why this test asserts on observed rows in the database rather than on a type.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IndexerConfig } from '../../src/types.ts';
import { OracleIndexer } from '../../src/indexer/index.ts';

const original = { dataDir: process.env.ORACLE_DATA_DIR, dbPath: process.env.ORACLE_DB_PATH };
const cleanup: string[] = [];

afterEach(() => {
  if (original.dataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = original.dataDir;
  if (original.dbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = original.dbPath;
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function indexOneLearning(body = '# Stable\n\nsearchable content') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vecqueue-'));
  cleanup.push(tmp);
  const dataDir = path.join(tmp, 'data');
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.ORACLE_DATA_DIR = dataDir;
  const dbPath = path.join(dataDir, 'oracle.db');
  process.env.ORACLE_DB_PATH = dbPath;

  const learnings = path.join(repoRoot, 'ψ', 'memory', 'learnings');
  fs.mkdirSync(learnings, { recursive: true });
  fs.writeFileSync(path.join(learnings, 'stable.md'), body, 'utf8');

  const config: IndexerConfig = {
    repoRoot,
    dbPath,
    chromaPath: path.join(dataDir, 'chroma'),
    sourcePaths: {
      resonance: 'ψ/memory/resonance',
      learnings: 'ψ/memory/learnings',
      retrospectives: 'ψ/memory/retrospectives',
      distillations: 'ψ/memory/distillations',
      learn: 'ψ/learn',
    },
  };
  const indexer = new OracleIndexer(config);
  try {
    await indexer.index();
  } finally {
    await indexer.close();
  }
  return dbPath;
}

function rows<T>(dbPath: string, sql: string): T[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query(sql).all() as T[];
  } finally {
    db.close();
  }
}

describe('indexing one document queues vector work', () => {
  test('the queue is not empty — it was 0 for every document, on every run', async () => {
    const dbPath = await indexOneLearning();
    const jobs = rows<{ id: string }>(dbPath, 'SELECT id FROM indexing_jobs');
    expect(jobs.length).toBeGreaterThan(0);
  });

  test('one job per registered embedding model, all pending', async () => {
    const dbPath = await indexOneLearning();
    const jobs = rows<{ model_key: string; status: string; doc_id: string }>(
      dbPath,
      'SELECT model_key, status, doc_id FROM indexing_jobs',
    );

    // Distinct models, not N copies for one model.
    expect(new Set(jobs.map((job) => job.model_key)).size).toBe(jobs.length);
    expect(jobs.every((job) => job.status === 'pending')).toBe(true);
    expect(jobs.every((job) => job.doc_id.length > 0)).toBe(true);
  });

  test('every queued job points at a document that was actually stored', async () => {
    const dbPath = await indexOneLearning();
    const jobs = rows<{ doc_id: string }>(dbPath, 'SELECT doc_id FROM indexing_jobs');
    const docs = rows<{ id: string }>(dbPath, 'SELECT id FROM oracle_documents');
    const known = new Set(docs.map((doc) => doc.id));

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.filter((job) => !known.has(job.doc_id))).toEqual([]);
  });

  test('each job names a collection for its model', async () => {
    const dbPath = await indexOneLearning();
    const jobs = rows<{ collection: string }>(dbPath, 'SELECT collection FROM indexing_jobs');
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => typeof job.collection === 'string' && job.collection.length > 0)).toBe(true);
  });
});
