import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as schema from '../../db/schema.ts';
import { REPO_ROOT } from '../../config.ts';
import { handleLearn } from '../learn.ts';
import type { ToolContext } from '../types.ts';

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
);
`;

const ORIGINAL_ENQUEUE = process.env.ORACLE_INDEXER_ENQUEUE;

let sqlite: Database;
let tmpRoot: string;
let filePath: string | null;

beforeEach(() => {
  process.env.ORACLE_INDEXER_ENQUEUE = '1';
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-frontmatter-'));
  sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA);
  filePath = null;
});

afterEach(() => {
  try { sqlite.close(); } catch {}
  if (filePath && fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch {}
  if (fs.existsSync(tmpRoot)) try { fs.rmSync(tmpRoot, { recursive: true }); } catch {}
  if (ORIGINAL_ENQUEUE) process.env.ORACLE_INDEXER_ENQUEUE = ORIGINAL_ENQUEUE;
  else delete process.env.ORACLE_INDEXER_ENQUEUE;
});

describe('handleLearn vault interchange frontmatter', () => {
  test('writes source, tags, and project fields into indexed markdown', async () => {
    const ctx: ToolContext = {
      db: drizzle(sqlite, { schema }),
      sqlite,
      repoRoot: tmpRoot,
      vectorStore: null as unknown as ToolContext['vectorStore'],
      vectorStatus: 'unknown',
      version: 'test',
    };

    const res = await handleLearn(ctx, {
      pattern: `frontmatter branch ${Date.now()} ${Math.random()}`,
      source: 'M5 enqueue test',
      concepts: ['m5', 'vault-interchange'],
      project: 'github.com/Soul-Brews-Studio/arra-oracle-v3',
    });
    const parsed = JSON.parse(res.content[0].text);
    filePath = path.join(REPO_ROOT, parsed.file);
    const row = sqlite.query('SELECT content FROM oracle_fts WHERE id = ?').get(parsed.id) as {
      content: string;
    };

    expect(parsed.success).toBe(true);
    expect(row.content).toContain('source: M5 enqueue test');
    expect(row.content).toContain('tags: [m5, vault-interchange]');
    expect(row.content).toContain('project: github.com/soul-brews-studio/arra-oracle-v3');
  });
});
