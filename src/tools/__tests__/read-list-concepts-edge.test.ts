import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolContext } from '../types.ts';
import { handleConcepts } from '../concepts.ts';
import { handleList } from '../list.ts';
import { handleRead } from '../read.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedGhqRoot = process.env.GHQ_ROOT;

let root = '';
let dbMod: typeof import('../../db/index.ts');
let ctx: ToolContext;

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tools-edge-'));
  const repoRoot = path.join(root, 'repo');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.ORACLE_DATA_DIR = dataDir;
  process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
  process.env.GHQ_ROOT = path.join(root, 'missing-ghq');

  dbMod = await import('../../db/index.ts');
  dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  ctx = { db: dbMod.db, sqlite: dbMod.sqlite, repoRoot } as ToolContext;

  const now = Date.now();
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id: 'safe-doc',
    type: 'learning',
    sourceFile: 'ψ/memory/safe.md',
    concepts: JSON.stringify(['edge', 'tools']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }).run();
  dbMod.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('safe-doc', 'Safe title\nSafe content.', 'edge tools');
});

afterEach(() => {
  dbMod?.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  if (savedGhqRoot === undefined) delete process.env.GHQ_ROOT;
  else process.env.GHQ_ROOT = savedGhqRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('tools edge hardening', () => {
  test('read rejects missing input and path traversal outside repo siblings', async () => {
    const outsideDir = path.join(root, 'repo-evil');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'secret.md'), 'classified');

    const missing = await handleRead(ctx, null as never);
    const traversal = await handleRead(ctx, { file: '../repo-evil/secret.md' });

    expect(missing.isError).toBe(true);
    expect(parse(missing).error).toContain('Provide file or id');
    expect(traversal.isError).toBe(true);
    expect(JSON.stringify(parse(traversal))).not.toContain('classified');
  });

  test('list defaults null input but rejects non-integer pagination', async () => {
    const defaults = parse(await handleList(ctx, null as never));
    expect(defaults.type).toBe('all');
    expect(defaults.limit).toBe(10);

    await expect(handleList(ctx, { limit: 1.5 } as never)).rejects.toThrow('limit must be an integer');
    await expect(handleList(ctx, { offset: '1' } as never)).rejects.toThrow('offset must be a number');
  });

  test('concepts defaults null input and rejects invalid type filters', async () => {
    const defaults = parse(await handleConcepts(ctx, null as never));
    expect(defaults.filter_type).toBe('all');
    expect(defaults.concepts.map((item: { name: string }) => item.name)).toContain('edge');

    await expect(handleConcepts(ctx, { type: 'unknown' } as never)).rejects.toThrow('Invalid type');
  });
});
