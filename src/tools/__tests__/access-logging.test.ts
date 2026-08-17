/**
 * Adoption-audit logging defects (2026-08-17):
 * - MCP oracle_search logged search_log.project as NULL even when a project
 *   filter was supplied, making scoped retrieval unverifiable in owner logs.
 * - oracle_read never wrote document_access rows, so real read-throughs left
 *   no owning access evidence at all.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-access-log-'));
process.env.ORACLE_DATA_DIR = path.join(tmp, 'data');
const dbPath = path.join(tmp, 'oracle.db');

const { createDatabase, resetDefaultDatabaseForTests, closeDb } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(dbPath);
const { oracleDocuments } = await import('../../db/schema.ts');
const { handleSearch } = await import('../search.ts');
const { handleRead } = await import('../read.ts');
import type { ToolContext } from '../types.ts';

const { sqlite, db } = createDatabase(dbPath);
const now = Date.now();
db.insert(oracleDocuments).values({
  id: 'doc-logged',
  type: 'learning',
  sourceFile: 'ψ/memory/learnings/logged.md',
  concepts: JSON.stringify(['oracle']),
  createdAt: now, updatedAt: now, indexedAt: now,
  project: 'github.com/ttt3p/orchestrator-vnext',
  createdBy: 'indexer',
}).run();
sqlite.prepare('INSERT INTO oracle_fts (id, content) VALUES (?, ?)')
  .run('doc-logged', 'governance decision retrieval evidence body');

const ctx: ToolContext = { sqlite, db, repoRoot: tmp } as ToolContext;

afterAll(() => {
  try { closeDb(); } catch { /* already closed */ }
  resetDefaultDatabaseForTests(':memory:');
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('owning access logs record real retrieval', () => {
  test('search_log.project carries the supplied project filter', async () => {
    await handleSearch(ctx, {
      query: 'governance decision retrieval',
      project: 'github.com/ttt3p/orchestrator-vnext',
      mode: 'fts',
      limit: 3,
    } as never);
    const row = sqlite.prepare('SELECT project FROM search_log ORDER BY id DESC LIMIT 1').get() as { project: string | null };
    expect(row.project).toBe('github.com/ttt3p/orchestrator-vnext');
  });

  test('oracle_read writes a document_access row (id path and file-only path)', async () => {
    await handleRead(ctx, { id: 'doc-logged' } as never);
    let rows = sqlite.prepare(
      "SELECT access_type AS t, project FROM document_access WHERE document_id = 'doc-logged' AND access_type = 'read'",
    ).all() as Array<{ t: string; project: string | null }>;
    expect(rows.length).toBe(1);
    expect(rows[0].project).toBe('github.com/ttt3p/orchestrator-vnext');

    fs.mkdirSync(path.join(tmp, 'ψ', 'memory', 'learnings'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'ψ', 'memory', 'learnings', 'logged.md'), 'on-disk body');
    await handleRead(ctx, { file: 'ψ/memory/learnings/logged.md' } as never);
    const fileOnly = sqlite.prepare(
      "SELECT project FROM document_access WHERE document_id = 'doc-logged' AND access_type = 'read' ORDER BY id DESC LIMIT 1",
    ).get() as { project: string | null };
    // file-only path: project resolved from the owning row, never NULL here
    expect(fileOnly.project).toBe('github.com/ttt3p/orchestrator-vnext');
    rows = sqlite.prepare(
      "SELECT access_type AS t FROM document_access WHERE document_id = 'doc-logged' AND access_type = 'read'",
    ).all() as Array<{ t: string }>;
    expect(rows.length).toBe(2);
  });
});

describe('default-context reads stay default-tenant-scoped', () => {
  test('file-only read in ambient-less context never resolves a tenant-b row', async () => {
    const src = 'ψ/memory/learnings/cross-tenant.md';
    db.insert(oracleDocuments).values([
      { id: 'doc-default', type: 'learning', sourceFile: src, concepts: '[]',
        createdAt: now, updatedAt: now, indexedAt: now, project: 'github.com/ttt3p/default-proj', createdBy: 'indexer' },
      { id: 'doc-tenant-b', tenantId: 'tenant-b', type: 'learning', sourceFile: src, concepts: '[]',
        createdAt: now, updatedAt: now, indexedAt: now, project: 'github.com/ttt3p/tenant-b-proj', createdBy: 'indexer' },
    ]).run();
    fs.writeFileSync(path.join(tmp, 'ψ', 'memory', 'learnings', 'cross-tenant.md'), 'cross tenant on-disk body');

    await handleRead(ctx, { file: src } as never);
    const logged = sqlite.prepare(
      'SELECT document_id AS d, project, tenant_id AS t FROM document_access ORDER BY id DESC LIMIT 1',
    ).get() as { d: string; project: string | null; t: string };
    expect(logged.d).toBe('doc-default');
    expect(logged.project).toBe('github.com/ttt3p/default-proj');
    expect(logged.t).toBe('default');
  });
});

describe('default storage readonly flag honors both env forms', async () => {
  const { defaultStorageReadonly } = await import('../../db/index.ts');
  test('ORACLE_READ_ONLY=true and ORACLE_VECTOR_READONLY=1 both force readonly; neither set stays writable', () => {
    expect(defaultStorageReadonly({ ORACLE_READ_ONLY: 'true' } as never)).toBe(true);
    expect(defaultStorageReadonly({ ORACLE_READ_ONLY: ' TRUE ' } as never)).toBe(true);
    expect(defaultStorageReadonly({ ORACLE_VECTOR_READONLY: '1' } as never)).toBe(true);
    expect(defaultStorageReadonly({} as never)).toBe(false);
    expect(defaultStorageReadonly({ ORACLE_READ_ONLY: 'false' } as never)).toBe(false);
  });
});
