import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolContext } from '../types.ts';
import { handleRead } from '../read.ts';

// End-to-end regression for the unwired-callsite defect (ORA-SHARED-20260820-06
// Riddler review): a unit test of isPathAllowed() alone passed while the real
// handleRead() callsite still called it without `project`, so the fix never
// took effect for an actual caller. This drives handleRead() itself — the
// only path a real MCP/HTTP caller uses — through a ghq project entry
// symlinked outside agent-hub (the Barbara/nntn vault case).

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedGhqRoot = process.env.GHQ_ROOT;

let root = '';
let vaultTarget = '';
let dbMod: typeof import('../../db/index.ts');
let ctx: ToolContext;

const PROJECT = 'github.com/ttt3p/nntn';

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

beforeEach(async () => {
  // realpath the temp root immediately: on macOS os.tmpdir() sits under a
  // symlink (/var -> /private/var), so any path built on the raw root would
  // mismatch resolveFilePath's own realpath-based containment checks — a
  // test-environment artifact, not something production ghqRoot hits (it's
  // a stable, non-symlinked absolute path there).
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-read-e2e-')));
  const repoRoot = path.join(root, 'repo');
  const dataDir = path.join(root, 'data');
  const ghqRoot = path.join(root, 'ghq');
  vaultTarget = path.join(root, 'vault', 'nntn');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(ghqRoot, 'github.com', 'ttt3p'), { recursive: true });
  fs.mkdirSync(path.join(vaultTarget, 'ψ', 'memory'), { recursive: true });
  fs.symlinkSync(vaultTarget, path.join(ghqRoot, PROJECT));
  fs.writeFileSync(path.join(vaultTarget, 'ψ', 'memory', 'note.md'), 'nntn vault content');

  process.env.ORACLE_DATA_DIR = dataDir;
  process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
  process.env.GHQ_ROOT = ghqRoot;

  dbMod = await import('../../db/index.ts');
  dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  ctx = { db: dbMod.db, sqlite: dbMod.sqlite, repoRoot } as ToolContext;

  const now = Date.now();
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id: 'nntn-doc-1',
    type: 'learning',
    sourceFile: 'ψ/memory/note.md',
    project: PROJECT,
    concepts: JSON.stringify([]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }).run();
  dbMod.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('nntn-doc-1', 'cached fallback content — should NOT be returned', '');
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

describe('handleRead — ghq project symlinked outside agent-hub (e2e)', () => {
  test('resolves the file from disk (source=file), not the fts_cache fallback', async () => {
    const response = await handleRead(ctx, { id: 'nntn-doc-1' });
    const body = parse(response);

    expect(response.isError).toBeUndefined();
    expect(body.source).toBe('file');
    expect(body.content).toBe('nntn vault content');
    expect(body.resolved_path).toBe(fs.realpathSync(path.join(vaultTarget, 'ψ', 'memory', 'note.md')));
  });

  test('also resolves via file= without id, recovering the project from the DB', async () => {
    const response = await handleRead(ctx, { file: 'ψ/memory/note.md' });
    const body = parse(response);

    expect(response.isError).toBeUndefined();
    expect(body.source).toBe('file');
    expect(body.content).toBe('nntn vault content');
  });
});
