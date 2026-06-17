import { afterEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { Elysia } from 'elysia';
import { daemonApiPlugin } from '../../../src/routes/indexer-daemon/index.ts';
import type { DaemonApiDeps } from '../../../src/routes/indexer-daemon/index.ts';
import type { WorkerEvent } from '../../../src/indexer/worker.ts';

const MODELS = {
  'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
  qwen3: { collection: 'oracle_knowledge_qwen3' },
};

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
);`;

let openDbs: Database[] = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
});

function deps(overrides: Partial<DaemonApiDeps> = {}) {
  const db = new Database(':memory:');
  db.exec(MIGRATION_SQL);
  openDbs.push(db);
  return {
    db,
    models: MODELS,
    isShuttingDown: () => false,
    requestShutdown: () => undefined,
    subscribe: () => () => undefined,
    ...overrides,
  } satisfies DaemonApiDeps;
}

function app(deps: DaemonApiDeps) {
  return new Elysia().use(daemonApiPlugin(deps));
}

function jsonPost(body: unknown) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('indexer daemon queue route edges', () => {
  test('index route fans out to every model when model_key is omitted', async () => {
    const wired = deps();
    const res = await app(wired).handle(new Request('http://local/index', jsonPost({ doc_id: ' doc-all ' })));
    const body = await res.json() as { jobs: Array<{ docId: string; modelKey: string }> };
    const rows = wired.db
      .query<{ doc_id: string; model_key: string }, []>('SELECT doc_id, model_key FROM indexing_jobs ORDER BY model_key')
      .all();

    expect(res.status).toBe(200);
    expect(body.jobs.map((job) => job.modelKey).sort()).toEqual(['bge-m3', 'qwen3']);
    expect(rows).toEqual([
      { doc_id: 'doc-all', model_key: 'bge-m3' },
      { doc_id: 'doc-all', model_key: 'qwen3' },
    ]);
  });

  test('shutdown short-circuits invalid index bodies without enqueuing', async () => {
    const wired = deps({ isShuttingDown: () => true });
    const res = await app(wired).handle(new Request('http://local/index', jsonPost({ doc_id: '   ' })));
    const count = wired.db.query<{ c: number }, []>('SELECT COUNT(*) as c FROM indexing_jobs').get();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'shutting down' });
    expect(count?.c).toBe(0);
  });

  test('jobs route rejects blank filters and caps oversized limits', async () => {
    const wired = deps();
    const insert = wired.db.prepare(
      `INSERT INTO indexing_jobs (id, doc_id, model_key, collection, status, attempts, created_at)
       VALUES (?, ?, 'bge-m3', ?, 'pending', 0, ?)`,
    );
    for (let i = 0; i < 1001; i++) insert.run(`job-${i}`, `doc-${i}`, MODELS['bge-m3'].collection, i);

    const route = app(wired);
    const blankStatus = await route.handle(new Request('http://local/jobs?status=%20%20'));
    const blankModel = await route.handle(new Request('http://local/jobs?model=%20%20'));
    const zeroLimit = await route.handle(new Request('http://local/jobs?limit=0'));
    const capped = await route.handle(new Request('http://local/jobs?limit=1001'));
    const cappedBody = await capped.json() as { count: number };

    expect(blankStatus.status).toBe(400);
    expect(blankModel.status).toBe(400);
    expect(zeroLimit.status).toBe(400);
    expect(cappedBody.count).toBe(1000);
  });
});

test('indexer daemon event stream serializes published worker events', async () => {
  let publish: ((event: WorkerEvent) => void) | undefined;
  const wired = deps({
    subscribe: (cb) => {
      publish = cb;
      return () => undefined;
    },
  });
  const res = await app(wired).handle(new Request('http://local/events'));
  const reader = res.body!.getReader();

  publish?.({
    type: 'claimed',
    job: { id: 'job-1', docId: 'doc-1', modelKey: 'bge-m3', collection: MODELS['bge-m3'].collection },
  });
  const { value } = await reader.read();
  await reader.cancel();
  const chunk = new TextDecoder().decode(value);

  expect(res.status).toBe(200);
  expect(chunk).toContain('event: claimed\n');
  expect(chunk).toContain('"docId":"doc-1"');
  expect(chunk).toContain('"modelKey":"bge-m3"');
});
