import { afterEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IndexerConfig } from '../../src/types.ts';
import { OracleIndexer } from '../../src/indexer/index.ts';

const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;

let cleanup: string[] = [];

afterEach(() => {
  restoreEnv();
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ψ reindex hardening', () => {
  test('indexes ψ to FTS5 and queues vector jobs only when content changes', async () => {
    const h = makeHarness('incremental');
    writeLearning(h.repoRoot, 'stable.md', '# Stable\n\ninitial searchable content');

    await runIndex(h);
    const firstJobs = scalar(h.dbPath, 'SELECT COUNT(*) FROM indexing_jobs');
    expect(firstJobs).toBeGreaterThan(0);
    expect(ftsBySource(h.dbPath, 'ψ/memory/learnings/stable.md')).toContain('initial searchable');

    exec(h.dbPath, "UPDATE indexing_jobs SET status = 'done'");
    await runIndex(h);
    expect(scalar(h.dbPath, 'SELECT COUNT(*) FROM indexing_jobs')).toBe(firstJobs);

    writeLearning(h.repoRoot, 'stable.md', '# Stable\n\nchanged vector-worthy content');
    await runIndex(h);
    expect(scalar(h.dbPath, 'SELECT COUNT(*) FROM indexing_jobs')).toBe(firstJobs * 2);
    expect(scalar(h.dbPath, "SELECT COUNT(*) FROM indexing_jobs WHERE status = 'pending'")).toBe(firstJobs);
    expect(ftsBySource(h.dbPath, 'ψ/memory/learnings/stable.md')).toContain('changed vector-worthy');
  });

  test('supersedes stale document ids when a source reindexes to a new id', async () => {
    const h = makeHarness('supersede');
    writeLearning(h.repoRoot, 'rotate.md', '---\nid: old-rotate\n---\nold body');
    await runIndex(h);

    writeLearning(h.repoRoot, 'rotate.md', '---\nid: new-rotate\n---\nnew body');
    await runIndex(h);

    const db = new Database(h.dbPath, { readonly: true });
    try {
      const oldRow = db.query(`
        SELECT superseded_by AS byId, superseded_reason AS reason
        FROM oracle_documents WHERE id = 'old-rotate'
      `).get() as { byId: string | null; reason: string | null };
      const newRow = db.query(`
        SELECT superseded_by AS byId FROM oracle_documents WHERE id = 'new-rotate'
      `).get() as { byId: string | null };
      expect(oldRow).toEqual({ byId: 'new-rotate', reason: 'superseded by indexer reindex' });
      expect(newRow).toEqual({ byId: null });
      expect(ftsContent(h.dbPath, 'old-rotate')).toContain('old body');
      expect(ftsContent(h.dbPath, 'new-rotate')).toContain('new body');
    } finally {
      db.close();
    }
  });

  test('keeps SQLite and FTS current when vector queueing is unavailable', async () => {
    const h = makeHarness('partial');
    writeLearning(h.repoRoot, 'queue-down.md', '# Queue Down\n\nfts survives missing queue');

    const indexer = new OracleIndexer(configFor(h));
    try {
      (indexer as unknown as { sqlite: Database }).sqlite.exec('DROP TABLE indexing_jobs');
      await indexer.index();
    } finally {
      await indexer.close();
    }

    expect(ftsBySource(h.dbPath, 'ψ/memory/learnings/queue-down.md')).toContain('fts survives missing queue');
    expect(scalar(h.dbPath, 'SELECT COUNT(*) FROM oracle_documents')).toBe(1);
  });
});

function makeHarness(name: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `arra-indexer-${name}-`));
  cleanup.push(tmp);
  const dataDir = path.join(tmp, 'data');
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.ORACLE_DATA_DIR = dataDir;
  process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
  return { tmp, dataDir, repoRoot, dbPath: process.env.ORACLE_DB_PATH };
}

function writeLearning(repoRoot: string, filename: string, body: string): void {
  const dir = path.join(repoRoot, 'ψ', 'memory', 'learnings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body, 'utf8');
}

async function runIndex(h: ReturnType<typeof makeHarness>): Promise<void> {
  const indexer = new OracleIndexer(configFor(h));
  try { await indexer.index(); }
  finally { await indexer.close(); }
}

function configFor(h: ReturnType<typeof makeHarness>): IndexerConfig {
  return {
    repoRoot: h.repoRoot,
    dbPath: h.dbPath,
    chromaPath: path.join(h.dataDir, 'chroma'),
    sourcePaths: {
      resonance: 'ψ/memory/resonance',
      learnings: 'ψ/memory/learnings',
      retrospectives: 'ψ/memory/retrospectives',
      distillations: 'ψ/memory/distillations',
      learn: 'ψ/learn',
    },
  };
}

function ftsContent(dbPath: string, id: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.query('SELECT content FROM oracle_fts WHERE id = ?').get(id) as { content: string })?.content ?? '';
  } finally {
    db.close();
  }
}

function ftsBySource(dbPath: string, sourceFile: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.query(`
      SELECT f.content FROM oracle_documents d
      JOIN oracle_fts f ON f.id = d.id
      WHERE d.source_file = ?
      LIMIT 1
    `).get(sourceFile) as { content: string })?.content ?? '';
  } finally {
    db.close();
  }
}

function scalar(dbPath: string, sql: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query(sql).get() as Record<string, number> | undefined;
    return row ? Number(Object.values(row)[0]) : 0;
  } finally {
    db.close();
  }
}

function exec(dbPath: string, sql: string): void {
  const db = new Database(dbPath);
  try { db.exec(sql); }
  finally { db.close(); }
}

function restoreEnv(): void {
  if (originalDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = originalDataDir;
  if (originalDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = originalDbPath;
}
