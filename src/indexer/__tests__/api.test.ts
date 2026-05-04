/**
 * M3 daemon HTTP API tests — Hono app, in-process via app.fetch().
 * No port binding, no Bun.serve, no real workers. Tests the API contract.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import Database from 'bun:sqlite';
import { enqueueIndexJob } from '../jobs.ts';
import { createDaemonApp, makeEventBus, type ApiDeps } from '../api.ts';
import type { WorkerEvent } from '../worker.ts';

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
  qwen3: { collection: 'oracle_knowledge_qwen3' },
};

function makeDeps(): ApiDeps & { _shutdownFlag: { v: boolean }; _bus: ReturnType<typeof makeEventBus<WorkerEvent>> } {
  const db = new Database(':memory:');
  db.exec(MIGRATION_SQL);
  const flag = { v: false };
  const bus = makeEventBus<WorkerEvent>();
  return {
    db,
    models: MODELS,
    isShuttingDown: () => flag.v,
    requestShutdown: () => { flag.v = true; },
    subscribe: bus.subscribe,
    _shutdownFlag: flag,
    _bus: bus,
  };
}

describe('GET /health', () => {
  it('returns ok with queue depth + models', async () => {
    const deps = makeDeps();
    enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    enqueueIndexJob(deps.db, { docId: 'doc-B', modelKey: 'qwen3', models: MODELS });
    const app = createDaemonApp(deps);
    const res = await app.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; service: string; queue_depth: Record<string, number>; models: string[] };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('arra-indexer');
    expect(body.queue_depth['bge-m3']).toBe(1);
    expect(body.queue_depth.qwen3).toBe(1);
    expect(body.models.sort()).toEqual(['bge-m3', 'qwen3']);
  });

  it('reports shutting_down flag', async () => {
    const deps = makeDeps();
    deps._shutdownFlag.v = true;
    const app = createDaemonApp(deps);
    const res = await app.fetch(new Request('http://localhost/health'));
    const body = await res.json() as { shutting_down: boolean };
    expect(body.shutting_down).toBe(true);
  });
});

describe('POST /index', () => {
  it('enqueues for all registered models when model_key omitted', async () => {
    const deps = makeDeps();
    const app = createDaemonApp(deps);
    const res = await app.fetch(
      new Request('http://localhost/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: 'doc-X' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { jobs: Array<{ modelKey: string }> };
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs.map((j) => j.modelKey).sort()).toEqual(['bge-m3', 'qwen3']);
  });

  it('enqueues for one model when model_key specified', async () => {
    const deps = makeDeps();
    const app = createDaemonApp(deps);
    const res = await app.fetch(
      new Request('http://localhost/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: 'doc-X', model_key: 'bge-m3' }),
      }),
    );
    const body = await res.json() as { jobs: Array<{ modelKey: string }> };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].modelKey).toBe('bge-m3');
  });

  it('returns 400 when doc_id missing', async () => {
    const deps = makeDeps();
    const app = createDaemonApp(deps);
    const res = await app.fetch(
      new Request('http://localhost/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('doc_id required');
  });

  it('returns 400 on invalid JSON', async () => {
    const deps = makeDeps();
    const app = createDaemonApp(deps);
    const res = await app.fetch(
      new Request('http://localhost/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 503 when shutting down', async () => {
    const deps = makeDeps();
    deps._shutdownFlag.v = true;
    const app = createDaemonApp(deps);
    const res = await app.fetch(
      new Request('http://localhost/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_id: 'doc-X' }),
      }),
    );
    expect(res.status).toBe(503);
  });
});

describe('GET /jobs', () => {
  it('lists all jobs without filters', async () => {
    const deps = makeDeps();
    enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    enqueueIndexJob(deps.db, { docId: 'doc-B', modelKey: 'qwen3', models: MODELS });
    const app = createDaemonApp(deps);
    const res = await app.fetch(new Request('http://localhost/jobs'));
    const body = await res.json() as { jobs: Array<{ doc_id: string; model_key: string }>; count: number };
    expect(body.count).toBe(2);
    expect(body.jobs.map((j) => j.doc_id).sort()).toEqual(['doc-A', 'doc-B']);
  });

  it('filters by status', async () => {
    const deps = makeDeps();
    enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    deps.db.exec("UPDATE indexing_jobs SET status = 'done' WHERE doc_id = 'doc-A'");
    enqueueIndexJob(deps.db, { docId: 'doc-B', modelKey: 'bge-m3', models: MODELS });
    const app = createDaemonApp(deps);
    const res = await app.fetch(new Request('http://localhost/jobs?status=pending'));
    const body = await res.json() as { jobs: Array<{ doc_id: string }>; count: number };
    expect(body.count).toBe(1);
    expect(body.jobs[0].doc_id).toBe('doc-B');
  });

  it('filters by model', async () => {
    const deps = makeDeps();
    enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'qwen3', models: MODELS });
    const app = createDaemonApp(deps);
    const res = await app.fetch(new Request('http://localhost/jobs?model=qwen3'));
    const body = await res.json() as { jobs: Array<{ model_key: string }>; count: number };
    expect(body.count).toBe(1);
    expect(body.jobs[0].model_key).toBe('qwen3');
  });

  it('respects limit param (default 100, capped at 1000)', async () => {
    const deps = makeDeps();
    for (let i = 0; i < 5; i++) {
      enqueueIndexJob(deps.db, { docId: `doc-${i}`, modelKey: 'bge-m3', models: MODELS });
    }
    const app = createDaemonApp(deps);
    const res = await app.fetch(new Request('http://localhost/jobs?limit=3'));
    const body = await res.json() as { jobs: unknown[]; count: number };
    expect(body.count).toBe(3);
  });
});

describe('POST /drain', () => {
  it('flips shutdown flag and returns 200', async () => {
    const deps = makeDeps();
    expect(deps._shutdownFlag.v).toBe(false);
    const app = createDaemonApp(deps);
    const res = await app.fetch(new Request('http://localhost/drain', { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('draining');
    expect(deps._shutdownFlag.v).toBe(true);
  });
});

describe('makeEventBus', () => {
  it('publishes to all subscribers; unsubscribe removes', () => {
    const bus = makeEventBus<{ n: number }>();
    const seenA: number[] = [];
    const seenB: number[] = [];
    const unsubA = bus.subscribe((ev) => seenA.push(ev.n));
    const unsubB = bus.subscribe((ev) => seenB.push(ev.n));
    bus.publish({ n: 1 });
    bus.publish({ n: 2 });
    unsubA();
    bus.publish({ n: 3 });
    unsubB();
    bus.publish({ n: 4 });
    expect(seenA).toEqual([1, 2]);
    expect(seenB).toEqual([1, 2, 3]);
  });

  it('one subscriber throwing does not break others', () => {
    const bus = makeEventBus<number>();
    const seen: number[] = [];
    bus.subscribe(() => { throw new Error('boom'); });
    bus.subscribe((n) => seen.push(n));
    bus.publish(42);
    expect(seen).toEqual([42]);
  });
});
