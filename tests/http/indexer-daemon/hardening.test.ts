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
    const res = await app(wired).handle(new Request('http://local/jobs?status=%20pending%20&model=%20bge-m3%20&limit=1'));
    const body = await res.json() as { count: number; jobs: Array<{ doc_id: string }> };

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.jobs[0].doc_id).toBe('doc-a');
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
