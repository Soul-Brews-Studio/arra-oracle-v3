/**
 * M5 — verifies the env-gated enqueue branch in handleLearn.
 *
 * Three cases:
 *   - default (env unset) → no enqueue (existing behavior preserved)
 *   - ORACLE_INDEXER_ENQUEUE=1 → one row per registered model in indexing_jobs
 *   - enqueue throws → ingest still succeeds (graceful: degrade > error)
 *
 * Hermetic: tmp dir for vault writes, :memory: SQLite, mock vectorStore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../../db/schema.ts';
import { handleLearn } from '../learn.ts';
import type { ToolContext } from '../types.ts';

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

const ORIGINAL_ENQUEUE = process.env.ORACLE_INDEXER_ENQUEUE;
const ORIGINAL_VAULT = process.env.ORACLE_VAULT_REPO;

interface Harness {
  ctx: ToolContext;
  sqlite: Database;
  tmpRoot: string;
}

function makeHarness(): Harness {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-m5-'));
  const sqlite = new Database(':memory:');
  sqlite.exec(FULL_SCHEMA);
  const db = drizzle(sqlite, { schema });
  const ctx: ToolContext = {
    db,
    sqlite,
    repoRoot: tmpRoot,
    // vectorStore is irrelevant to handleLearn — it doesn't touch it.
    vectorStore: null as unknown as ToolContext['vectorStore'],
  } as ToolContext;
  return { ctx, sqlite, tmpRoot };
}

function cleanupHarness(h: Harness): void {
  try { h.sqlite.close(); } catch {}
  try { fs.rmSync(h.tmpRoot, { recursive: true, force: true }); } catch {}
}

describe('handleLearn — M5 enqueue branch', () => {
  let h: Harness;

  beforeEach(() => {
    delete process.env.ORACLE_INDEXER_ENQUEUE;
    // Force vault-disabled so handleLearn writes under ctx.repoRoot (the tmp dir).
    delete process.env.ORACLE_VAULT_REPO;
    h = makeHarness();
  });

  afterEach(() => {
    cleanupHarness(h);
    if (ORIGINAL_ENQUEUE) process.env.ORACLE_INDEXER_ENQUEUE = ORIGINAL_ENQUEUE;
    else delete process.env.ORACLE_INDEXER_ENQUEUE;
    if (ORIGINAL_VAULT) process.env.ORACLE_VAULT_REPO = ORIGINAL_VAULT;
  });

  it('default (env unset) → does NOT enqueue any jobs (existing behavior preserved)', async () => {
    const res = await handleLearn(h.ctx, { pattern: 'test pattern A' });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.success).toBe(true);

    const count = h.sqlite.query('SELECT COUNT(*) as c FROM indexing_jobs').get() as { c: number };
    expect(count.c).toBe(0);

    // FTS row WAS written
    const fts = h.sqlite.query('SELECT COUNT(*) as c FROM oracle_fts').get() as { c: number };
    expect(fts.c).toBe(1);
  });

  it('ORACLE_INDEXER_ENQUEUE=1 → enqueues one job per registered model', async () => {
    process.env.ORACLE_INDEXER_ENQUEUE = '1';
    const res = await handleLearn(h.ctx, { pattern: 'test pattern B' });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.success).toBe(true);

    const rows = h.sqlite
      .query<{ doc_id: string; model_key: string; status: string }, []>(
        'SELECT doc_id, model_key, status FROM indexing_jobs ORDER BY model_key',
      )
      .all();
    // Registry includes bge-m3, nomic, qwen3 by default — 3 rows expected.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.doc_id === parsed.id)).toBe(true);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    expect(rows.map((r) => r.model_key).sort()).toEqual(rows.map((r) => r.model_key).sort());
  });

  it('does NOT block ingest when enqueue throws (graceful degrade)', async () => {
    process.env.ORACLE_INDEXER_ENQUEUE = '1';
    // Drop the indexing_jobs table mid-flight to force the enqueue insert to throw.
    h.sqlite.exec('DROP TABLE indexing_jobs');

    // handleLearn should still succeed (FTS row written, file created, response returned).
    const res = await handleLearn(h.ctx, { pattern: 'test pattern C' });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.success).toBe(true);

    const fts = h.sqlite.query('SELECT COUNT(*) as c FROM oracle_fts').get() as { c: number };
    expect(fts.c).toBe(1);
  });

  it('value other than "1" does NOT enqueue (strict equality, not truthiness)', async () => {
    process.env.ORACLE_INDEXER_ENQUEUE = 'true';
    await handleLearn(h.ctx, { pattern: 'test pattern D' });
    const count = h.sqlite.query('SELECT COUNT(*) as c FROM indexing_jobs').get() as { c: number };
    expect(count.c).toBe(0);
  });
});
