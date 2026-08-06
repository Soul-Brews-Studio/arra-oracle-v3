import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAllMarkdownFiles } from '../collectors.ts';
import { enqueueIndexJob } from '../jobs.ts';
import { listDirs, listFiles } from '../watch-utils.ts';
import { runWorker } from '../worker.ts';

const JOB_SCHEMA = `
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

describe('indexer filesystem hardening', () => {
  test('treats missing scan roots as empty instead of throwing', () => {
    const missing = path.join(os.tmpdir(), `arra-indexer-missing-${Date.now()}`);

    expect(getAllMarkdownFiles(missing)).toEqual([]);
    expect(listDirs(missing)).toEqual([]);
    expect(listFiles(missing, () => true)).toEqual([]);
  });

  test('skips directories that vanish during recursive watch scans', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-indexer-vanish-'));
    const gone = path.join(root, 'gone');
    fs.mkdirSync(gone);
    fs.rmSync(gone, { recursive: true, force: true });

    try {
      expect(listDirs(gone)).toEqual([]);
      expect(listFiles(gone, () => true)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('indexer worker hardening', () => {
  test('ignores throwing event observers and still completes the job', async () => {
    const db = new Database(':memory:');
    db.exec(JOB_SCHEMA);
    enqueueIndexJob(db, {
      docId: 'doc-observer',
      models: { 'bge-m3': { collection: 'oracle_knowledge_bge_m3' } },
    });

    let checks = 0;
    const stats = await runWorker('bge-m3', {
      db,
      getDocText: () => 'observer failures must not poison indexing',
      embed: async () => [1, 2, 3],
      upsertVector: async () => undefined,
      isShuttingDown: () => ++checks > 1,
      onEvent: () => { throw new Error('observer failed'); },
    });

    const row = db.query<{ status: string }, []>('SELECT status FROM indexing_jobs').get();
    expect(stats).toMatchObject({ processed: 1, errors: 0 });
    expect(row?.status).toBe('done');
    db.close();
  });
});
