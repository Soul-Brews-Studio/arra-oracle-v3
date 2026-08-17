/**
 * Integration proof for cwd-based project auto-scope (2026-08-17 fix):
 * handleSearch called with cwd ONLY (no explicit project) must resolve the
 * project through detectProject — including the inverted ghq topology where
 * the real checkout is hostless and the ghq path is a symlink pointing at
 * it — then (a) scope FTS results to project+universal rows and (b) write
 * the resolved project into the real search_log table.
 *
 * ORACLE_DB_PATH is pointed at a temp file BEFORE any module import so the
 * process-global db (used by logSearch) lands in this test's sandbox. That
 * requires dynamic imports throughout — bunfig `isolate = true` gives each
 * test file its own process, so this cannot leak into other files.
 */

import { afterAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-cwd-scope-'));
process.env.ORACLE_DB_PATH = path.join(sandbox, 'global-oracle.db');

const { createDatabase } = await import('../../db/create.ts');
const { db: globalDb } = await import('../../db/index.ts');
const { oracleDocuments, searchLog } = await import('../../db/schema.ts');
const { handleSearch } = await import('../search.ts');
const { eq } = await import('drizzle-orm');

type ToolContext = import('../types.ts').ToolContext;

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

/** Build TINE's inverted topology: hostless real repo + ghq symlink at it. */
function makeInvertedTopology(name: string): { realRepo: string; ghqLink: string } {
  const root = path.join(sandbox, name);
  const realRepo = path.join(root, 'hub', 'orchestrator-vnext');
  fs.mkdirSync(realRepo, { recursive: true });
  execFileSync('git', ['-C', realRepo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync(
    'git',
    ['-C', realRepo, 'remote', 'add', 'origin', 'https://github.com/ttt3p/orchestrator-vnext.git'],
    { stdio: 'ignore' },
  );
  const ghqDir = path.join(root, 'ghq', 'github.com', 'ttt3p');
  fs.mkdirSync(ghqDir, { recursive: true });
  const ghqLink = path.join(ghqDir, 'orchestrator-vnext');
  fs.symlinkSync(realRepo, ghqLink);
  return { realRepo, ghqLink };
}

const connections: Array<{ storage: { close(): void } }> = [];

function makeCtx(name: string, marker: string): ToolContext {
  const connection = createDatabase(path.join(sandbox, `${name}.db`));
  connections.push(connection);
  const now = Date.now();
  connection.db.insert(oracleDocuments).values([
    {
      id: 'current-project-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/current-state.md',
      concepts: JSON.stringify(['recovery']),
      project: 'github.com/ttt3p/orchestrator-vnext',
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
    },
    {
      id: 'other-project-doc',
      type: 'learning',
      sourceFile: 'other/ψ/memory/other.md',
      concepts: JSON.stringify(['recovery']),
      project: 'github.com/other/repo',
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
    },
  ]).run();
  const insertFts = connection.sqlite.prepare(
    'INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)',
  );
  insertFts.run('current-project-doc', `recovery state ${marker} token`, 'recovery');
  insertFts.run('other-project-doc', `recovery state ${marker} token`, 'recovery');
  return {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: path.join(sandbox, `${name}-repo`),
    vectorStore: { name: 'mock-vector' } as any,
    vectorStatus: 'connected',
    version: 'test-version',
  } as ToolContext;
}

function loggedProjectsFor(query: string): Array<string | null> {
  return globalDb
    .select({ project: searchLog.project })
    .from(searchLog)
    .where(eq(searchLog.query, query))
    .all()
    .map((row) => row.project);
}

afterAll(() => {
  for (const connection of connections.splice(0)) connection.storage.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('cwd-only search from hostless real checkout scopes results and logs search_log.project', async () => {
  const { realRepo } = makeInvertedTopology('real-path-case');
  const ctx = makeCtx('real-path-case', 'realcase');
  const query = 'recovery state realcase';

  const body = parse(await handleSearch(ctx, { query, mode: 'fts', limit: 5, cwd: realRepo }));

  const ids = body.results.map((r: { id: string }) => r.id);
  expect(ids).toContain('current-project-doc');
  expect(ids).not.toContain('other-project-doc');
  expect(loggedProjectsFor(query)).toEqual(['github.com/ttt3p/orchestrator-vnext']);
});

test('cwd-only search through the ghq symlink resolves the same project', async () => {
  const { ghqLink } = makeInvertedTopology('symlink-case');
  const ctx = makeCtx('symlink-case', 'symlinkcase');
  const query = 'recovery state symlinkcase';

  const body = parse(await handleSearch(ctx, { query, mode: 'fts', limit: 5, cwd: ghqLink }));

  const ids = body.results.map((r: { id: string }) => r.id);
  expect(ids).toContain('current-project-doc');
  expect(ids).not.toContain('other-project-doc');
  expect(loggedProjectsFor(query)).toEqual(['github.com/ttt3p/orchestrator-vnext']);
});
