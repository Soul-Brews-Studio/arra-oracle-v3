import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-has-indexing-jobs-'));
const dataDir = path.join(tmp, 'data');
const dbPath = path.join(dataDir, 'oracle.db');

fs.mkdirSync(dataDir, { recursive: true });

const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = dbPath;

const { createDatabase, closeDb, resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(dbPath);
const { oracleDocuments } = await import('../../db/schema.ts');
const { enqueueVectorReindexJobs } = await import('../reindex-state.ts');

beforeAll(() => {
  const { sqlite, db } = createDatabase(dbPath);
  // createDatabase runs migrations, which creates the indexing_jobs table.
  db.insert(oracleDocuments)
    .values([
      {
        id: 'doc-a',
        type: 'learning',
        sourceFile: 'ψ/memory/learnings/a.md',
        concepts: 'alpha',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        indexedAt: Date.now(),
      },
      {
        id: 'doc-b',
        type: 'learning',
        sourceFile: 'ψ/memory/learnings/b.md',
        concepts: 'beta',
        updatedAt: Date.now(),
        createdAt: Date.now(),
        indexedAt: Date.now(),
      },
    ])
    .run();
  sqlite.close();
});

afterAll(() => {
  closeDb();
  process.env.ORACLE_DATA_DIR = originalDataDir;
  process.env.ORACLE_DB_PATH = originalDbPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('enqueueVectorReindexJobs — hasIndexingJobsTable regression (#2611)', () => {
  test('queues jobs when indexing_jobs table exists (was returning all-failed before fix)', () => {
    const { db, sqlite } = createDatabase(dbPath);
    try {
      const docs = [
        {
          id: 'doc-a',
          type: 'learning' as const,
          sourceFile: 'ψ/memory/learnings/a.md',
          concepts: ['alpha'],
          content: 'alpha',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'doc-b',
          type: 'learning' as const,
          sourceFile: 'ψ/memory/learnings/b.md',
          concepts: ['beta'],
          content: 'beta',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      const models = { 'bge-m3': { collection: 'oracle_knowledge_bge_m3' } };
      const stats = enqueueVectorReindexJobs(db, docs, models, new Set(docs.map((d) => d.id)));

      // Before the fix: hasIndexingJobsTable returned false because drizzle's
      // db.get(sql`...`) returns a positional array, not an object — so the
      // function short-circuited with stats.failed = docs.length * modelKeys.length.
      expect(stats.failed).toBe(0);
      expect(stats.queued).toBeGreaterThan(0);
    } finally {
      sqlite.close();
    }
  });

  test('returns all-failed when indexing_jobs table is absent', () => {
    const { Database } = require('bun:sqlite');
    const { drizzle } = require('drizzle-orm/bun-sqlite');
    const sqlitePath = path.join(tmp, 'no-jobs-table.db');
    const sqlite = new Database(sqlitePath);
    // No migration; no indexing_jobs table.
    sqlite.run('CREATE TABLE oracle_documents (id TEXT PRIMARY KEY)');
    const db = drizzle(sqlite);

    const docs = [
      {
        id: 'doc-a',
        type: 'learning' as const,
        sourceFile: 'ψ/memory/learnings/a.md',
        concepts: ['alpha'],
        content: 'alpha',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    const models = { 'bge-m3': { collection: 'oracle_knowledge_bge_m3' } };
    const stats = enqueueVectorReindexJobs(db, docs, models, new Set(['doc-a']));

    expect(stats.failed).toBe(1);
    expect(stats.queued).toBe(0);
    sqlite.close();
  });
});
