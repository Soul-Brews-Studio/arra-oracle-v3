import { afterEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { Elysia } from 'elysia';
import { daemonApiPlugin, makeEventBus } from '../../../src/routes/indexer-daemon/index.ts';
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

describe('indexer daemon input hardening', () => {
  test('trims doc_id/model_key before enqueuing', async () => {
    const wired = deps();
    const res = await app(wired).handle(new Request('http://local/index', jsonPost({ doc_id: ' doc-a ', model_key: ' bge-m3 ' })));
    const body = await res.json() as { jobs: Array<{ docId: string; modelKey: string }> };
    const row = wired.db.query<{ doc_id: string; model_key: string }, []>('SELECT doc_id, model_key FROM indexing_jobs').get();

    expect(res.status).toBe(200);
    expect(body.jobs).toEqual([{ id: expect.any(String), docId: 'doc-a', modelKey: 'bge-m3', collection: MODELS['bge-m3'].collection }]);
    expect(row).toEqual({ doc_id: 'doc-a', model_key: 'bge-m3' });
  });

  test('rejects blank doc ids and invalid model keys', async () => {
    const route = app(deps());
    expect((await route.handle(new Request('http://local/index', jsonPost({ doc_id: '   ' })))).status).toBe(400);
    expect((await route.handle(new Request('http://local/index', jsonPost({ doc_id: 'doc', model_key: '   ' })))).status).toBe(400);
    expect((await route.handle(new Request('http://local/index', jsonPost({ doc_id: 'doc', model_key: 'missing' })))).status).toBe(400);
  });

  test('validates job filters and safe limits', async () => {
    const route = app(deps());
    expect((await route.handle(new Request('http://local/jobs?status=bogus'))).status).toBe(400);
    expect((await route.handle(new Request('http://local/jobs?model=bogus'))).status).toBe(400);
    expect((await route.handle(new Request('http://local/jobs?limit=-1'))).status).toBe(400);
    expect((await route.handle(new Request('http://local/jobs?limit=abc'))).status).toBe(400);
  });

  test('trims valid job filters', async () => {
    const wired = deps();
    await app(wired).handle(new Request('http://local/index', jsonPost({ doc_id: 'doc-a', model_key: 'bge-m3' })));
    const res = await app(wired).handle(new Request('http://local/jobs?status=%20pending%20&model=%20bge-m3%20&limit=%201%20'));
    const body = await res.json() as { count: number; jobs: Array<{ doc_id: string }> };

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.jobs[0].doc_id).toBe('doc-a');
  });

  test('reports queue depth for pending and claimed jobs only', async () => {
    const wired = deps();
    const insert = wired.db.prepare(
      `INSERT INTO indexing_jobs (id, doc_id, model_key, collection, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    );
    insert.run('p1', 'doc-1', 'bge-m3', MODELS['bge-m3'].collection, 'pending', 1);
    insert.run('c1', 'doc-2', 'bge-m3', MODELS['bge-m3'].collection, 'claimed', 2);
    insert.run('d1', 'doc-3', 'bge-m3', MODELS['bge-m3'].collection, 'done', 3);
    insert.run('p2', 'doc-4', 'qwen3', MODELS.qwen3.collection, 'pending', 4);

    const res = await app(wired).handle(new Request('http://local/health'));
    const body = await res.json() as { queue_depth: Record<string, number>; models: string[] };

    expect(body.queue_depth).toEqual({ 'bge-m3': 2, qwen3: 1 });
    expect(body.models).toEqual(['bge-m3', 'qwen3']);
  });

  test('drain marks the daemon unavailable for new index jobs', async () => {
    let shuttingDown = false;
    let drainCalls = 0;
    const wired = deps({
      isShuttingDown: () => shuttingDown,
      requestShutdown: () => { drainCalls += 1; shuttingDown = true; },
    });
    const route = app(wired);

    const drain = await route.handle(new Request('http://local/drain', { method: 'POST' }));
    const health = await route.handle(new Request('http://local/health'));
    const index = await route.handle(new Request('http://local/index', jsonPost({ doc_id: 'doc-a' })));

    expect(await drain.json()).toEqual({ status: 'draining' });
    expect((await health.json() as { shutting_down: boolean }).shutting_down).toBe(true);
    expect(index.status).toBe(503);
    expect(drainCalls).toBe(1);
  });
});

test('indexer daemon event stream unsubscribes when the client cancels', async () => {
  let unsubscribed = 0;
  const wired = deps({ subscribe: (_cb: (ev: WorkerEvent) => void) => () => { unsubscribed += 1; } });
  const res = await app(wired).handle(new Request('http://local/events'));

  await res.body?.cancel();
  expect(res.status).toBe(200);
  expect(unsubscribed).toBe(1);
});

test('indexer daemon event bus isolates throwing subscribers and supports idempotent unsubscribe', () => {
  const events: string[] = [];
  const bus = makeEventBus<{ type: string }>();
  const unsubscribeThrower = bus.subscribe(() => { throw new Error('subscriber failed'); });
  const unsubscribeRecorder = bus.subscribe((event) => events.push(event.type));

  bus.publish({ type: 'claimed' });
  unsubscribeThrower();
  unsubscribeThrower();
  unsubscribeRecorder();
  bus.publish({ type: 'done' });

  expect(events).toEqual(['claimed']);
});
