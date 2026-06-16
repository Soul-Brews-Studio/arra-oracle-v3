/**
 * M6 auto-index watcher tests — queue jobs when learn files change.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'bun:sqlite';
import { startLearnWatcher } from '../learn-watcher.ts';

const FULL_SCHEMA = `
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
  created_by TEXT
);
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('startLearnWatcher', () => {
  let repoRoot: string;
  let db: Database;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-watcher-'));
    db = new Database(':memory:');
    db.exec(FULL_SCHEMA);
  });

  afterEach(() => {
    try { db.close(); } catch {}
    try { fs.rmSync(repoRoot, { recursive: true, force: true }); } catch {}
  });

  it('enqueues jobs when an existing learn markdown file is changed', async () => {
    const learnDir = path.join(repoRoot, 'ψ', 'memory', 'learnings');
    const filePath = path.join(learnDir, 'note.md');
    const sourceFile = path.join('ψ', 'memory', 'learnings', 'note.md').split(path.sep).join('/');

    fs.mkdirSync(learnDir, { recursive: true });
    fs.writeFileSync(filePath, 'initial');

    db.exec(
      `INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at, created_by)
       VALUES ('learning-note', 'learning', '${sourceFile}', '[]', 0, 0, 0, 'manual')`,
    );

    const stop = startLearnWatcher({
      db,
      models: MODELS,
      repoRoot,
      debounceMs: 20,
    });

    fs.writeFileSync(filePath, 'updated', 'utf8');
    await wait(300);

    const rows = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM indexing_jobs').get() as { count: number };
    expect(rows.count).toBe(Object.keys(MODELS).length);

    const jobs = db.query<{ model_key: string }>('SELECT model_key FROM indexing_jobs ORDER BY model_key').all() as { model_key: string }[];
    expect(jobs).toHaveLength(Object.keys(MODELS).length);
    expect(jobs.map((r) => r.model_key).sort()).toEqual(Object.keys(MODELS).sort());

    stop();
  });

  it('does nothing for non-markdown files', async () => {
    const learnDir = path.join(repoRoot, 'ψ', 'memory', 'learnings');
    const filePath = path.join(learnDir, 'note.txt');
    fs.mkdirSync(learnDir, { recursive: true });
    fs.writeFileSync(filePath, 'tmp', 'utf8');

    const stop = startLearnWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });

    fs.writeFileSync(filePath, 'changed', 'utf8');
    await wait(300);

    const rows = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM indexing_jobs').get() as { count: number };
    expect(rows.count).toBe(0);

    stop();
  });
});
