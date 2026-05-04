/**
 * M2 indexer worker tests — happy path, error paths, shutdown, doc-missing.
 *
 * Hermetic: in-memory SQLite, mock embed/upsertVector/getDocText, no Ollama,
 * no LanceDB. Uses fake timers via short pollIntervalMs so the loop turns over
 * fast.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import Database from 'bun:sqlite';
import { enqueueIndexJob } from '../jobs.ts';
import { runWorker, type WorkerDeps, type WorkerEvent } from '../worker.ts';

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
`;

const MODELS = {
  'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
};

function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec(MIGRATION_SQL);
  return db;
}

interface TestHarness {
  db: Database;
  embedded: Array<{ model: string; text: string }>;
  upserted: Array<{ collection: string; docId: string; vectorLen: number }>;
  events: WorkerEvent[];
  shutdownAfter: number;  // signal shutdown after this many job iterations
}

function makeDeps(harness: TestHarness, overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  const docTexts: Record<string, string | null> = {
    'doc-A': 'air quality monitoring with PM2.5 sensors',
    'doc-B': 'flood radar accuracy on JIBCHAIN L1 blockchain',
    'doc-deleted': null,
  };
  let iterations = 0;
  return {
    db: harness.db,
    getDocText: (id) => (id in docTexts ? docTexts[id] : `synthetic content for ${id}`),
    embed: async (model, text) => {
      harness.embedded.push({ model, text });
      return new Array(1024).fill(0).map(() => Math.random());
    },
    upsertVector: async (collection, docId, vector) => {
      harness.upserted.push({ collection, docId, vectorLen: vector.length });
    },
    isShuttingDown: () => {
      iterations++;
      return iterations > harness.shutdownAfter;
    },
    pollIntervalMs: 5,  // fast empty-queue polls in tests
    onEvent: (ev) => harness.events.push(ev),
    ...overrides,
  };
}

describe('runWorker — happy path', () => {
  it('processes one job: claim → embed → upsert → mark done', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });

    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 2 };
    const stats = await runWorker('bge-m3', makeDeps(harness));

    expect(stats.processed).toBe(1);
    expect(stats.errors).toBe(0);
    expect(harness.embedded).toHaveLength(1);
    expect(harness.embedded[0]).toEqual({
      model: 'bge-m3',
      text: 'air quality monitoring with PM2.5 sensors',
    });
    expect(harness.upserted).toHaveLength(1);
    expect(harness.upserted[0]).toEqual({
      collection: 'oracle_knowledge_bge_m3',
      docId: 'doc-A',
      vectorLen: 1024,
    });

    const row = db.query('SELECT status FROM indexing_jobs').get() as { status: string };
    expect(row.status).toBe('done');
  });

  it('processes multiple jobs in FIFO order', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });
    enqueueIndexJob(db, { docId: 'doc-B', models: MODELS });

    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 3 };
    const stats = await runWorker('bge-m3', makeDeps(harness));

    expect(stats.processed).toBe(2);
    expect(harness.upserted.map((u) => u.docId)).toEqual(['doc-A', 'doc-B']);
  });

  it('emits claimed → done events', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });

    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 2 };
    await runWorker('bge-m3', makeDeps(harness));

    const types = harness.events.map((e) => e.type);
    expect(types).toContain('claimed');
    expect(types).toContain('done');
    const doneEvent = harness.events.find((e) => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>;
    expect(doneEvent.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('runWorker — error paths', () => {
  it('marks job error when embed throws', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });

    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 2 };
    const deps = makeDeps(harness, {
      embed: async () => { throw new Error('Ollama timeout'); },
    });
    const stats = await runWorker('bge-m3', deps);

    expect(stats.processed).toBe(0);
    expect(stats.errors).toBe(1);
    expect(harness.upserted).toHaveLength(0);

    const row = db.query('SELECT status, error FROM indexing_jobs').get() as { status: string; error: string };
    expect(row.status).toBe('error');
    expect(row.error).toBe('Ollama timeout');

    const err = harness.events.find((e) => e.type === 'error') as Extract<WorkerEvent, { type: 'error' }>;
    expect(err.error).toBe('Ollama timeout');
  });

  it('marks job error when upsertVector throws', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });

    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 2 };
    const deps = makeDeps(harness, {
      upsertVector: async () => { throw new Error('LanceDB write failed'); },
    });
    const stats = await runWorker('bge-m3', deps);

    expect(stats.errors).toBe(1);
    expect(harness.embedded).toHaveLength(1);  // embedding succeeded before write failed

    const row = db.query('SELECT status, error FROM indexing_jobs').get() as { status: string; error: string };
    expect(row.status).toBe('error');
    expect(row.error).toBe('LanceDB write failed');
  });

  it('continues processing after one job errors (does not poison the worker)', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-fail', models: MODELS });
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });

    let callCount = 0;
    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 3 };
    const deps = makeDeps(harness, {
      embed: async (model, text) => {
        callCount++;
        if (callCount === 1) throw new Error('first call fails');
        harness.embedded.push({ model, text });
        return new Array(1024).fill(0);
      },
    });
    const stats = await runWorker('bge-m3', deps);

    expect(stats.processed).toBe(1);
    expect(stats.errors).toBe(1);
    expect(harness.upserted).toHaveLength(1);
    expect(harness.upserted[0].docId).toBe('doc-A');
  });
});

describe('runWorker — doc-missing graceful handling', () => {
  it('marks job done (no embed/upsert) when doc text is null', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-deleted', models: MODELS });

    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 2 };
    const stats = await runWorker('bge-m3', makeDeps(harness));

    expect(stats.processed).toBe(1);
    expect(stats.errors).toBe(0);
    expect(harness.embedded).toHaveLength(0);  // no embed call
    expect(harness.upserted).toHaveLength(0);

    const row = db.query('SELECT status FROM indexing_jobs').get() as { status: string };
    expect(row.status).toBe('done');

    const types = harness.events.map((e) => e.type);
    expect(types).toContain('doc_missing');
    expect(types).toContain('claimed');
  });
});

describe('runWorker — shutdown', () => {
  it('exits cleanly when isShuttingDown() returns true', async () => {
    const db = freshDb();
    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 0 };
    const stats = await runWorker('bge-m3', makeDeps(harness));
    expect(stats.processed).toBe(0);
    expect(stats.emptyPolls).toBe(0);  // shutdown checked BEFORE first claim
  });

  it('processes in-flight job to completion before exiting on next loop check', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-A', models: MODELS });

    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 1 };
    const stats = await runWorker('bge-m3', makeDeps(harness));

    // First iteration: shutdown check returns false → job processed
    // Second iteration: shutdown check returns true → exit
    expect(stats.processed).toBe(1);
    expect(harness.upserted).toHaveLength(1);
  });
});

describe('runWorker — empty queue', () => {
  it('counts empty polls and emits idle events', async () => {
    const db = freshDb();
    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 3 };
    const stats = await runWorker('bge-m3', makeDeps(harness));

    expect(stats.processed).toBe(0);
    expect(stats.emptyPolls).toBeGreaterThan(0);
    const types = harness.events.map((e) => e.type);
    expect(types).toContain('idle');
  });
});

describe('runWorker — model isolation (plug-play)', () => {
  it('only processes jobs for its own model_key', async () => {
    const db = freshDb();
    enqueueIndexJob(db, { docId: 'doc-A', modelKey: 'bge-m3', models: { 'bge-m3': { collection: 'c1' }, qwen3: { collection: 'c2' } } });
    enqueueIndexJob(db, { docId: 'doc-B', modelKey: 'qwen3', models: { 'bge-m3': { collection: 'c1' }, qwen3: { collection: 'c2' } } });

    const harness: TestHarness = { db, embedded: [], upserted: [], events: [], shutdownAfter: 3 };
    const stats = await runWorker('bge-m3', makeDeps(harness));

    expect(stats.processed).toBe(1);
    expect(harness.upserted[0].docId).toBe('doc-A');
    // qwen3 job should still be pending
    const qwenRow = db.query('SELECT status FROM indexing_jobs WHERE model_key = ?').get('qwen3') as { status: string };
    expect(qwenRow.status).toBe('pending');
  });
});
