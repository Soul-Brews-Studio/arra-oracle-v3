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
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_by TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER
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
);
`;

const MODELS = {
  'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
  qwen3: { collection: 'oracle_knowledge_qwen3' },
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await wait(25);
  }
  throw new Error('timed out waiting for learn watcher');
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


  it('stores and enqueues new ψ/learn markdown files', async () => {
    const learnDir = path.join(repoRoot, 'ψ', 'learn', 'Soul-Brews-Studio', 'demo');
    const filePath = path.join(learnDir, 'exploration.md');

    fs.mkdirSync(learnDir, { recursive: true });
    fs.writeFileSync(filePath, '# Exploration\n\n## Finding\n\nAuto indexing should capture new learn docs.', 'utf8');

    const stop = startLearnWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });

    fs.writeFileSync(filePath, '# Exploration\n\n## Finding\n\nAuto indexing should capture updated learn docs.', 'utf8');
    await wait(300);

    const docs = db.query<{ id: string; source_file: string }>(
      'SELECT id, source_file FROM oracle_documents ORDER BY id',
    ).all() as { id: string; source_file: string }[];
    expect(docs).toHaveLength(1);
    expect(docs[0].source_file).toBe('ψ/learn/Soul-Brews-Studio/demo/exploration.md');

    const fts = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM oracle_fts').get() as { count: number };
    expect(fts.count).toBe(1);

    const jobs = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM indexing_jobs').get() as { count: number };
    expect(jobs.count).toBe(Object.keys(MODELS).length);

    stop();
  });


  it('stores and enqueues new ψ/memory/learnings markdown files', async () => {
    const learnDir = path.join(repoRoot, 'ψ', 'memory', 'learnings');
    const filePath = path.join(learnDir, 'fresh.md');

    fs.mkdirSync(learnDir, { recursive: true });
    fs.writeFileSync(filePath, '# Fresh\n\n## Lesson\n\nMemory learn files should auto-index too.', 'utf8');

    const stop = startLearnWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(300);

    const docs = db.query<{ source_file: string }>(
      'SELECT source_file FROM oracle_documents ORDER BY id',
    ).all() as { source_file: string }[];
    expect(docs).toEqual([{ source_file: 'ψ/memory/learnings/fresh.md' }]);

    const fts = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM oracle_fts').get() as { count: number };
    expect(fts.count).toBe(1);

    const jobs = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM indexing_jobs').get() as { count: number };
    expect(jobs.count).toBe(Object.keys(MODELS).length);

    stop();
  });

  it('stores files created under new ψ/learn directories after start', async () => {
    const filePath = path.join(repoRoot, 'ψ', 'learn', 'Soul-Brews-Studio', 'demo', 'new-tree.md');

    const stop = startLearnWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(50);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# New Tree\n\n## Finding\n\nWatcher scans directories created after startup.', 'utf8');

    await waitFor(() => {
      const jobs = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM indexing_jobs').get();
      return jobs?.count === Object.keys(MODELS).length;
    }, 2_500);

    const doc = db.query<{ source_file: string }, []>('SELECT source_file FROM oracle_documents').get();
    expect(doc?.source_file).toBe('ψ/learn/Soul-Brews-Studio/demo/new-tree.md');

    stop();
  });

  it('stores project-first vault ψ/learn files', async () => {
    const filePath = path.join(repoRoot, 'github.com', 'Soul-Brews-Studio', 'demo', 'ψ', 'learn', 'codex', 'note.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Project Learn\n\n## Finding\n\nProject-first vault learn docs auto-index.', 'utf8');

    const stop = startLearnWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await waitFor(() => {
      const row = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM indexing_jobs').get();
      return row?.count === Object.keys(MODELS).length;
    });

    const doc = db.query<{ source_file: string; project: string }, []>(
      'SELECT source_file, project FROM oracle_documents',
    ).get();
    expect(doc?.source_file).toBe('github.com/Soul-Brews-Studio/demo/ψ/learn/codex/note.md');
    expect(doc?.project).toBe('github.com/soul-brews-studio/demo');

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
