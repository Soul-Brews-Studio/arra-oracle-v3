import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'bun:sqlite';
import { startProjectWatcher } from '../project-watcher.ts';
import { parsePsiProjectFile } from '../project-doc-source.ts';
import { storeSqliteDocuments } from '../learn-doc-source.ts';

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
CREATE TABLE oracle_pointer_index (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  doc_ids TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
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

async function waitFor(check: () => boolean, timeoutMs = 2_500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await wait(25);
  }
  throw new Error('timed out waiting for project watcher');
}

describe('startProjectWatcher', () => {
  let repoRoot: string;
  let db: Database;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-watcher-'));
    fs.mkdirSync(path.join(repoRoot, 'ψ', 'projects'), { recursive: true });
    db = new Database(':memory:');
    db.exec(FULL_SCHEMA);
  });

  afterEach(() => {
    try { stop?.(); } catch {}
    stop = undefined;
    try { db.close(); } catch {}
    try { fs.rmSync(repoRoot, { recursive: true, force: true }); } catch {}
  });

  it('auto-indexes a new canonical project Markdown file', async () => {
    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });

    const filePath = path.join(repoRoot, 'ψ', 'projects', 'oracle', 'context.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Oracle\n\ngatefivefreshprojecttoken', 'utf8');

    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM oracle_documents WHERE source_file='ψ/projects/oracle/context.md'"
      ).get();
      return (row?.count ?? 0) > 0;
    });

    const doc = db.query<{ project: string }, []>(
      "SELECT project FROM oracle_documents WHERE source_file='ψ/projects/oracle/context.md'"
    ).get();
    expect(doc?.project).toBe('oracle');

    const fts = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gatefivefreshprojecttoken'"
    ).get();
    expect(fts?.count).toBeGreaterThan(0);

    const jobs = db.query<{ count: number }, []>(
      'SELECT COUNT(*) AS count FROM indexing_jobs'
    ).get();
    expect(jobs?.count).toBe(Object.keys(MODELS).length);
  });

  it('refreshes FTS when an existing project file is edited', async () => {
    const filePath = path.join(repoRoot, 'ψ', 'projects', 'oracle', 'context.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Oracle\n\ngatefiveoldtoken', 'utf8');

    storeSqliteDocuments(
      db,
      parsePsiProjectFile('ψ/projects/oracle/context.md', fs.readFileSync(filePath, 'utf8'))
    );
    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    fs.writeFileSync(filePath, '# Oracle\n\ngatefivenewtoken', 'utf8');

    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gatefivenewtoken'"
      ).get();
      return (row?.count ?? 0) > 0;
    });

    const oldHit = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gatefiveoldtoken'"
    ).get();
    expect(oldHit?.count).toBe(0);

    const doc = db.query<{ project: string }, []>(
      "SELECT project FROM oracle_documents WHERE source_file='ψ/projects/oracle/context.md' AND superseded_at IS NULL"
    ).get();
    expect(doc?.project).toBe('oracle');
  });

  it('keeps ψ/projects/README.md universal on automatic refresh', async () => {
    const filePath = path.join(repoRoot, 'ψ', 'projects', 'README.md');
    fs.writeFileSync(filePath, '# Projects\n\ninitialreadmetoken', 'utf8');
    storeSqliteDocuments(
      db,
      parsePsiProjectFile('ψ/projects/README.md', fs.readFileSync(filePath, 'utf8'))
    );

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    fs.writeFileSync(filePath, '# Projects\n\nupdatedreadmetoken', 'utf8');

    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'updatedreadmetoken'"
      ).get();
      return (row?.count ?? 0) > 0;
    });

    const row = db.query<{ project: string | null }, []>(
      "SELECT project FROM oracle_documents WHERE source_file='ψ/projects/README.md' AND superseded_at IS NULL"
    ).get();
    expect(row?.project).toBeNull();
  });

  it('fails closed for invalid project ids and ignores non-Markdown files', async () => {
    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });

    const invalid = path.join(repoRoot, 'ψ', 'projects', 'Bad_ID', 'context.md');
    const nonMd = path.join(repoRoot, 'ψ', 'projects', 'oracle', 'note.txt');
    fs.mkdirSync(path.dirname(invalid), { recursive: true });
    fs.mkdirSync(path.dirname(nonMd), { recursive: true });
    fs.writeFileSync(invalid, '# Invalid\n\nshouldnotindex', 'utf8');
    fs.writeFileSync(nonMd, 'shouldnotindexeither', 'utf8');

    await wait(400);
    const docs = db.query<{ count: number }, []>(
      'SELECT COUNT(*) AS count FROM oracle_documents'
    ).get();
    expect(docs?.count).toBe(0);
  });

  it('observes a project directory created after watcher startup', async () => {
    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(50);

    const filePath = path.join(repoRoot, 'ψ', 'projects', 'client-alpha', 'research', 'note.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Research\n\ndynamicprojecttreetoken', 'utf8');

    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM oracle_documents WHERE project='client-alpha'"
      ).get();
      return (row?.count ?? 0) > 0;
    });

    const fts = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'dynamicprojecttreetoken'"
    ).get();
    expect(fts?.count).toBeGreaterThan(0);
  });

  it('removes the indexed projection and queues vector cleanup when a project source disappears', async () => {
    const filePath = path.join(repoRoot, 'ψ', 'projects', 'oracle', 'context.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Oracle\n\ndeferreddeletiontoken', 'utf8');
    storeSqliteDocuments(
      db,
      parsePsiProjectFile('ψ/projects/oracle/context.md', fs.readFileSync(filePath, 'utf8'))
    );

    const stored = db.query<{ id: string }, []>(
      "SELECT id FROM oracle_documents WHERE source_file='ψ/projects/oracle/context.md' LIMIT 1"
    ).get();
    expect(stored?.id).toBeTruthy();

    const pointersBefore = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM oracle_pointer_index WHERE doc_ids LIKE ?"
    ).get(`%${stored!.id}%`);
    expect(pointersBefore?.count).toBeGreaterThan(0);

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    fs.unlinkSync(filePath);
    await wait(300);

    const docs = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_documents WHERE source_file='ψ/projects/oracle/context.md'"
    ).get();
    expect(docs?.count).toBe(0);

    const fts = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'deferreddeletiontoken'"
    ).get();
    expect(fts?.count).toBe(0);

    const cleanupJobs = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM indexing_jobs"
    ).get();
    expect(cleanupJobs?.count).toBeGreaterThan(0);

    const pointersAfter = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM oracle_pointer_index WHERE doc_ids LIKE ?"
    ).get(`%${stored!.id}%`);
    expect(pointersAfter?.count).toBe(0);
  });

  it('reconciles a pre-existing stale project source on startup', async () => {
    const sourceFile = 'ψ/projects/oracle/offline-delete.md';

    // Seed the derived index as if this source existed before shutdown.
    // Deliberately NEVER create the file on disk, so no filesystem deletion
    // event can make this test pass accidentally.
    storeSqliteDocuments(
      db,
      parsePsiProjectFile(
        sourceFile,
        '# Oracle\n\ngate6offlinedeletetoken'
      )
    );

    const stored = db.query<{ id: string }, []>(
      "SELECT id FROM oracle_documents WHERE source_file='ψ/projects/oracle/offline-delete.md' LIMIT 1"
    ).get();
    expect(stored?.id).toBeTruthy();

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(100);

    const docs = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_documents WHERE source_file='ψ/projects/oracle/offline-delete.md'"
    ).get();
    expect(docs?.count).toBe(0);

    const fts = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gate6offlinedeletetoken'"
    ).get();
    expect(fts?.count).toBe(0);

    const cleanupJobs = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM indexing_jobs WHERE doc_id = ?"
    ).get(stored!.id);
    expect(cleanupJobs?.count).toBeGreaterThan(0);
  });

  it('reconciles a project rename that happened while the watcher was stopped', async () => {
    const oldSource = 'ψ/projects/oracle/offline-old.md';
    const newSource = 'ψ/projects/oracle/offline-new.md';
    const newPath = path.join(repoRoot, newSource);

    // Derived DB state still reflects the old filename from before shutdown.
    storeSqliteDocuments(
      db,
      parsePsiProjectFile(
        oldSource,
        '# Oracle\n\ngate6offlinerenametoken'
      )
    );

    const oldStored = db.query<{ id: string }, []>(
      "SELECT id FROM oracle_documents WHERE source_file='ψ/projects/oracle/offline-old.md' LIMIT 1"
    ).get();
    expect(oldStored?.id).toBeTruthy();

    // Simulate the filesystem after an offline rename:
    // old path is absent, new path already exists before watcher startup.
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.writeFileSync(newPath, '# Oracle\n\ngate6offlinerenametoken', 'utf8');

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(100);

    const oldDocs = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_documents WHERE source_file='ψ/projects/oracle/offline-old.md'"
    ).get();
    expect(oldDocs?.count).toBe(0);

    const newDocs = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_documents WHERE source_file='ψ/projects/oracle/offline-new.md'"
    ).get();
    expect(newDocs?.count).toBeGreaterThan(0);

    const newStored = db.query<{ id: string }, []>(
      "SELECT id FROM oracle_documents WHERE source_file='ψ/projects/oracle/offline-new.md' LIMIT 1"
    ).get();
    expect(newStored?.id).toBeTruthy();
    expect(newStored?.id).not.toBe(oldStored!.id);

    const fts = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gate6offlinerenametoken'"
    ).get();
    expect(fts?.count).toBeGreaterThan(0);

    const cleanupJobs = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM indexing_jobs WHERE doc_id = ?"
    ).get(oldStored!.id);
    expect(cleanupJobs?.count).toBeGreaterThan(0);
  });

  it('reconciles a project Markdown rename to the new canonical source path', async () => {
    const oldPath = path.join(repoRoot, 'ψ', 'projects', 'oracle', 'context.md');
    const newPath = path.join(repoRoot, 'ψ', 'projects', 'oracle', 'context-renamed.md');
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, '# Oracle\n\ngate6renametoken', 'utf8');

    storeSqliteDocuments(
      db,
      parsePsiProjectFile(
        'ψ/projects/oracle/context.md',
        fs.readFileSync(oldPath, 'utf8')
      )
    );

    const oldStored = db.query<{ id: string }, []>(
      "SELECT id FROM oracle_documents WHERE source_file='ψ/projects/oracle/context.md' LIMIT 1"
    ).get();
    expect(oldStored?.id).toBeTruthy();

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(50);

    fs.renameSync(oldPath, newPath);
    await wait(800);

    const oldDocs = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_documents WHERE source_file='ψ/projects/oracle/context.md'"
    ).get();
    expect(oldDocs?.count).toBe(0);

    const newDocs = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_documents WHERE source_file='ψ/projects/oracle/context-renamed.md'"
    ).get();
    expect(newDocs?.count).toBeGreaterThan(0);

    const newStored = db.query<{ id: string }, []>(
      "SELECT id FROM oracle_documents WHERE source_file='ψ/projects/oracle/context-renamed.md' LIMIT 1"
    ).get();
    expect(newStored?.id).toBeTruthy();
    expect(newStored?.id).not.toBe(oldStored!.id);

    const fts = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gate6renametoken'"
    ).get();
    expect(fts?.count).toBeGreaterThan(0);

    const cleanupJobs = db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM indexing_jobs WHERE doc_id = ?"
    ).get(oldStored!.id);
    expect(cleanupJobs?.count).toBeGreaterThan(0);
  });

  it('does not create duplicate active rows across repeated edits and restart', async () => {
    const filePath = path.join(repoRoot, 'ψ', 'projects', 'oracle', 'duplicate-check.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });

    fs.writeFileSync(filePath, '# Oracle\n\ngate6duptoken1', 'utf8');
    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gate6duptoken1'"
      ).get();
      return (row?.count ?? 0) > 0;
    });

    fs.writeFileSync(filePath, '# Oracle\n\ngate6duptoken2', 'utf8');
    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gate6duptoken2'"
      ).get();
      return (row?.count ?? 0) > 0;
    });

    fs.writeFileSync(filePath, '# Oracle\n\ngate6duptoken3', 'utf8');
    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gate6duptoken3'"
      ).get();
      return (row?.count ?? 0) > 0;
    });

    // Simulate daemon restart after repeated live edits.
    stop();
    stop = undefined;

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(100);

    const active = db.query<{ count: number; distinct_ids: number }, []>(
      `SELECT
         COUNT(*) AS count,
         COUNT(DISTINCT id) AS distinct_ids
       FROM oracle_documents
       WHERE source_file='ψ/projects/oracle/duplicate-check.md'
         AND superseded_at IS NULL`
    ).get();

    expect(active?.count).toBe(1);
    expect(active?.distinct_ids).toBe(1);

    const currentFts = db.query<{ count: number }, []>(
      `SELECT COUNT(*) AS count
       FROM oracle_fts
       JOIN oracle_documents
         ON oracle_documents.id = oracle_fts.id
       WHERE oracle_documents.source_file='ψ/projects/oracle/duplicate-check.md'
         AND oracle_documents.superseded_at IS NULL
         AND oracle_fts MATCH 'gate6duptoken3'`
    ).get();

    expect(currentFts?.count).toBe(1);
  });

  it('supersedes stale chunk generations when an edit collapses a multi-chunk source', async () => {
    const projectDir = path.join(repoRoot, 'ψ', 'projects', 'oracle');
    const filePath = path.join(projectDir, 'chunk-lifecycle.md');
    fs.mkdirSync(projectDir, { recursive: true });

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(50);

    const paragraph = (token: string, fill: string) =>
      `${token} ${fill.repeat(650)}`;

    const initialContent = [
      '# Chunk Lifecycle',
      '',
      paragraph('gate6chunkoldalpha', 'a'),
      '',
      paragraph('gate6chunkoldbeta', 'b'),
      '',
      paragraph('gate6chunkoldgamma', 'c'),
    ].join('\n');

    fs.writeFileSync(filePath, initialContent, 'utf8');

    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        `SELECT COUNT(*) AS count
         FROM oracle_documents
         WHERE source_file='ψ/projects/oracle/chunk-lifecycle.md'
           AND superseded_at IS NULL`
      ).get();
      return (row?.count ?? 0) === 3;
    });

    const initialRows = db.query<{ id: string }, []>(
      `SELECT id
       FROM oracle_documents
       WHERE source_file='ψ/projects/oracle/chunk-lifecycle.md'
         AND superseded_at IS NULL
       ORDER BY id`
    ).all();

    expect(initialRows).toHaveLength(3);
    expect(initialRows.every((row) => row.id.includes('__chunk_'))).toBe(true);

    fs.writeFileSync(
      filePath,
      '# Chunk Lifecycle\n\ngate6chunkcurrenttoken',
      'utf8'
    );

    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        `SELECT COUNT(*) AS count
         FROM oracle_fts
         JOIN oracle_documents
           ON oracle_documents.id = oracle_fts.id
         WHERE oracle_documents.source_file='ψ/projects/oracle/chunk-lifecycle.md'
           AND oracle_documents.superseded_at IS NULL
           AND oracle_fts MATCH 'content:gate6chunkcurrenttoken'`
      ).get();
      return (row?.count ?? 0) === 1;
    });

    const rows = db.query<
      { id: string; superseded_at: number | null; superseded_by: string | null },
      []
    >(
      `SELECT id, superseded_at, superseded_by
       FROM oracle_documents
       WHERE source_file='ψ/projects/oracle/chunk-lifecycle.md'
       ORDER BY id`
    ).all();

    const active = rows.filter((row) => row.superseded_at === null);
    const stale = rows.filter((row) => row.superseded_at !== null);

    expect(active).toHaveLength(1);
    expect(stale).toHaveLength(3);
    expect(active[0].id.includes('__chunk_')).toBe(false);

    expect(stale.map((row) => row.id).sort()).toEqual(
      initialRows.map((row) => row.id).sort()
    );
    expect(stale.every((row) => row.superseded_by === active[0].id)).toBe(true);

    // P-001: historical superseded chunks remain in raw searchable history.
    const historicalFts = db.query<{ count: number }, []>(
      `SELECT COUNT(*) AS count
       FROM oracle_fts
       WHERE oracle_fts MATCH 'content:gate6chunkoldalpha'`
    ).get();
    expect(historicalFts?.count).toBe(1);

    // But historical chunks are no longer part of the active projection.
    const activeHistoricalFts = db.query<{ count: number }, []>(
      `SELECT COUNT(*) AS count
       FROM oracle_fts
       JOIN oracle_documents
         ON oracle_documents.id = oracle_fts.id
       WHERE oracle_documents.source_file='ψ/projects/oracle/chunk-lifecycle.md'
         AND oracle_documents.superseded_at IS NULL
         AND oracle_fts MATCH 'content:gate6chunkoldalpha'`
    ).get();
    expect(activeHistoricalFts?.count).toBe(0);

    const currentFts = db.query<{ count: number }, []>(
      `SELECT COUNT(*) AS count
       FROM oracle_fts
       JOIN oracle_documents
         ON oracle_documents.id = oracle_fts.id
       WHERE oracle_documents.source_file='ψ/projects/oracle/chunk-lifecycle.md'
         AND oracle_documents.superseded_at IS NULL
         AND oracle_fts MATCH 'content:gate6chunkcurrenttoken'`
    ).get();
    expect(currentFts?.count).toBe(1);
  });

  it('keeps identical knowledge distinct across different projects', async () => {
    const alphaDir = path.join(repoRoot, 'ψ', 'projects', 'client-alpha');
    const betaDir = path.join(repoRoot, 'ψ', 'projects', 'client-beta');
    fs.mkdirSync(alphaDir, { recursive: true });
    fs.mkdirSync(betaDir, { recursive: true });

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(50);

    const sharedContent = '# Shared Research\n\ngate6crossprojectsharedtoken';

    fs.writeFileSync(path.join(alphaDir, 'research.md'), sharedContent, 'utf8');
    fs.writeFileSync(path.join(betaDir, 'research.md'), sharedContent, 'utf8');

    await waitFor(() => {
      const row = db.query<{ count: number }, []>(
        `SELECT COUNT(*) AS count
         FROM oracle_documents
         WHERE source_file IN (
           'ψ/projects/client-alpha/research.md',
           'ψ/projects/client-beta/research.md'
         )
         AND superseded_at IS NULL`
      ).get();
      return (row?.count ?? 0) === 2;
    });

    const rows = db.query<
      { id: string; project: string; source_file: string },
      []
    >(
      `SELECT id, project, source_file
       FROM oracle_documents
       WHERE source_file IN (
         'ψ/projects/client-alpha/research.md',
         'ψ/projects/client-beta/research.md'
       )
       AND superseded_at IS NULL
       ORDER BY project`
    ).all();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.project)).toEqual(['client-alpha', 'client-beta']);
    expect(rows[0].id).not.toBe(rows[1].id);

    const fts = db.query<{ count: number }, []>(
      `SELECT COUNT(*) AS count
       FROM oracle_fts
       JOIN oracle_documents
         ON oracle_documents.id = oracle_fts.id
       WHERE oracle_documents.superseded_at IS NULL
         AND oracle_documents.project IN ('client-alpha', 'client-beta')
         AND oracle_fts MATCH 'gate6crossprojectsharedtoken'`
    ).get();

    expect(fts?.count).toBe(2);
  });

  it('fails closed when a project Markdown symlink resolves outside ψ/projects', async () => {
    const projectDir = path.join(repoRoot, 'ψ', 'projects', 'oracle');
    fs.mkdirSync(projectDir, { recursive: true });

    stop = startProjectWatcher({ db, models: MODELS, repoRoot, debounceMs: 20 });
    await wait(50);

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-watcher-outside-'));
    const outsideFile = path.join(outsideDir, 'outside.md');
    fs.writeFileSync(outsideFile, '# Outside\n\ngate6symlinkescapetoken', 'utf8');

    const linkPath = path.join(
      repoRoot,
      'ψ',
      'projects',
      'oracle',
      'linked-outside.md',
    );

    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(outsideFile, linkPath);

    await wait(400);

    const docs = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_documents WHERE source_file='ψ/projects/oracle/linked-outside.md'"
    ).get();

    const fts = db.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM oracle_fts WHERE oracle_fts MATCH 'gate6symlinkescapetoken'"
    ).get();

    expect(docs?.count).toBe(0);
    expect(fts?.count).toBe(0);

    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
