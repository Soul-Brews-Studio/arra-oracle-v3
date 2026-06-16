import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { Elysia } from 'elysia';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createWatcherRoutes } from '../../../src/routes/watcher/index.ts';
import { FileWatcherService } from '../../../src/services/file-watcher.ts';

const SCHEMA = `
CREATE TABLE oracle_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_file TEXT NOT NULL,
  concepts TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  superseded_by TEXT,
  superseded_at INTEGER,
  superseded_reason TEXT,
  origin TEXT,
  project TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_by TEXT
);
CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts, tokenize='porter unicode61');
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

const MODELS = {
  'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
  qwen3: { collection: 'oracle_knowledge_qwen3' },
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error('timed out waiting for watcher event');
}

describe('watcher HTTP routes', () => {
  let repoRoot = '';
  let db: Database;
  let service: FileWatcherService;
  let logs: string[];

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-watcher-'));
    db = new Database(':memory:');
    db.exec(SCHEMA);
    logs = [];
    service = new FileWatcherService({
      db,
      repoRoot,
      models: MODELS,
      debounceMs: 25,
      logger: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(String(msg)) },
    });
  });

  afterEach(() => {
    service.stop();
    db.close();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function fetcher() {
    const app = new Elysia().use(createWatcherRoutes(service));
    return createApiVersionedFetch((request) => app.handle(request));
  }

  async function call(pathname: string, init: RequestInit = {}) {
    const res = await fetcher()(new Request(`http://local${pathname}`, init));
    return { status: res.status, body: await res.json() as Record<string, any> };
  }

  test('starts, reports, and stops the watcher daemon', async () => {
    const started = await call('/api/v1/watcher/start', { method: 'POST' });
    expect(started.status).toBe(200);
    expect(started.body.running).toBe(true);
    expect(started.body.watchRoot).toEndWith(path.join('ψ', 'learn'));

    const status = await call('/api/v1/watcher/status');
    expect(status.body.watchedDirs).toBeGreaterThan(0);
    expect(status.body.events[0]).toMatchObject({ type: 'started' });

    const stopped = await call('/api/v1/watcher/stop', { method: 'POST' });
    expect(stopped.body.running).toBe(false);
  });

  test('auto re-indexes changed ψ/learn markdown after debounce', async () => {
    const learnDir = path.join(repoRoot, 'ψ', 'learn', 'github.com', 'owner', 'repo');
    const filePath = path.join(learnDir, 'watch.md');
    fs.mkdirSync(learnDir, { recursive: true });

    await call('/api/v1/watcher/start', { method: 'POST' });
    fs.writeFileSync(filePath, '# Watch\n\n## Finding\n\nWatcher routes queue vector indexing jobs.', 'utf8');

    await waitFor(() => count('indexing_jobs') === Object.keys(MODELS).length);

    expect(db.query<{ source_file: string }, []>('SELECT source_file FROM oracle_documents').get()?.source_file)
      .toBe('ψ/learn/github.com/owner/repo/watch.md');
    expect(count('oracle_fts')).toBe(1);
    expect(logs.some((line) => line.includes('re-indexed ψ/learn/github.com/owner/repo/watch.md'))).toBe(true);

    const status = await call('/api/v1/watcher/status');
    expect(status.body.events[0]).toMatchObject({ type: 'indexed', docs: 1, jobs: 2 });
  });

  test('debounces bursty writes into one re-index event', async () => {
    const learnDir = path.join(repoRoot, 'ψ', 'learn', 'github.com', 'owner', 'repo');
    const filePath = path.join(learnDir, 'burst.md');
    fs.mkdirSync(learnDir, { recursive: true });

    await call('/api/v1/watcher/start', { method: 'POST' });
    fs.writeFileSync(filePath, '# Burst\n\n## Finding\n\nFirst write.', 'utf8');
    fs.writeFileSync(filePath, '# Burst\n\n## Finding\n\nSecond write.', 'utf8');
    fs.writeFileSync(filePath, '# Burst\n\n## Finding\n\nThird write.', 'utf8');

    await waitFor(() => count('indexing_jobs') === Object.keys(MODELS).length);

    expect(count('oracle_documents')).toBe(1);
    expect(count('indexing_jobs')).toBe(Object.keys(MODELS).length);
  });

  function count(table: string): number {
    return db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0;
  }
});
