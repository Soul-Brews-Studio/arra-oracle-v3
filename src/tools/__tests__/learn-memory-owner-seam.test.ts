import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as schema from '../../db/schema.ts';
import type { ToolContext } from '../types.ts';

// Sandbox the module-level REPO_ROOT before config.ts is ever imported, so
// the unbound-seat test can never write into the live data dir (this suite
// runs under bun --isolate, one process per file).
const SANDBOX_REPO_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-seam-repo-'));
process.env.ORACLE_REPO_ROOT = SANDBOX_REPO_ROOT;
let handleLearn: typeof import('../learn.ts')['handleLearn'];
let ORACLE_DATA_DIR: string;
beforeAll(async () => {
  ({ handleLearn } = await import('../learn.ts'));
  ({ ORACLE_DATA_DIR } = await import('../../config.ts'));
});

// Same minimal schema the sibling learn fixtures use.
const SCHEMA = `
CREATE TABLE oracle_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_file TEXT NOT NULL,
  concepts TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  valid_time INTEGER,
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
CREATE TABLE learn_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  pattern_preview TEXT,
  source TEXT,
  concepts TEXT,
  created_at INTEGER NOT NULL,
  project TEXT
);
`;

const PRIOR_OWNER_ROOT = process.env.ORACLE_MEMORY_OWNER_ROOT;

let sqlite: Database;
let ownerRoot: string;

function makeCtx(): ToolContext {
  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'arra-seam-cwd-')),
    vectorStore: null as unknown as ToolContext['vectorStore'],
    vectorStatus: 'unknown',
    version: 'test',
  };
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA);
  ownerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-seam-owner-'));
});

afterEach(() => {
  try { sqlite.close(); } catch {}
  if (PRIOR_OWNER_ROOT === undefined) delete process.env.ORACLE_MEMORY_OWNER_ROOT;
  else process.env.ORACLE_MEMORY_OWNER_ROOT = PRIOR_OWNER_ROOT;
  try { fs.rmSync(ownerRoot, { recursive: true, force: true }); } catch {}
});

describe('oracle_learn memory-owner seam (birth spec v5 D1 / L1 gate)', () => {
  test('bound seat writes the learning under the owner root, never the data dir', async () => {
    process.env.ORACLE_MEMORY_OWNER_ROOT = ownerRoot;
    const pattern = `seam routing proof ${Date.now()}`;
    const res = await handleLearn(makeCtx(), {
      pattern,
      source: 'L1 seam test',
      project: 'github.com/TTT3P/orchestrator-vnext',
    });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.success).toBe(true);

    const expectedDir = path.join(ownerRoot, 'ψ', 'memory', 'learnings');
    const written = fs.readdirSync(expectedDir);
    expect(written).toHaveLength(1);
    expect(parsed.file).toBe(`ψ/memory/learnings/${written[0]}`);

    const dataDirLearnings = path.join(ORACLE_DATA_DIR, 'ψ', 'memory', 'learnings');
    if (fs.existsSync(dataDirLearnings)) {
      expect(fs.readdirSync(dataDirLearnings)).not.toContain(written[0]);
    }

    const bytes = fs.readFileSync(path.join(expectedDir, written[0]), 'utf-8');
    expect(bytes).toContain(pattern);
  });

  test('unbound seat keeps legacy routing (no behavior change)', async () => {
    delete process.env.ORACLE_MEMORY_OWNER_ROOT;
    const pattern = `legacy routing ${Date.now()}`;
    const res = await handleLearn(makeCtx(), { pattern, source: 'L1 seam test' });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.success).toBe(true);
    const ownerDir = path.join(ownerRoot, 'ψ');
    expect(fs.existsSync(ownerDir)).toBe(false);
    // Legacy target is the sandboxed REPO_ROOT — prove it landed there.
    expect(fs.existsSync(path.join(SANDBOX_REPO_ROOT, parsed.file))).toBe(true);
  });
});
