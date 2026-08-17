/**
 * Duplicate-result defect (2026-08-17): retros-only reindex upserts new
 * deterministic chunk ids but left the LEGACY active rows for the same source
 * files untouched, so searches returned both generations. The owning repair is
 * supersedeReplacedSourceDocs after store — history preserved, never deleted.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-retro-supersede-'));
process.env.ORACLE_DATA_DIR = path.join(tmp, 'data');
const dbPath = path.join(tmp, 'oracle.db');
const repoRoot = path.join(tmp, 'repo');

const { createDatabase, closeDb, resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(dbPath);
const { indexRetrospectives } = await import('../retro-index.ts');
const { runWithTenant } = await import('../../middleware/tenant.ts');

afterAll(() => {
  try { closeDb(); } catch { /* already closed */ }
  resetDefaultDatabaseForTests(':memory:');
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('retros-only reindex supersedes replaced legacy rows', () => {
  test('legacy active row for the same source becomes superseded; unrelated rows untouched', async () => {
    const retroDir = path.join(repoRoot, 'ψ', 'memory', 'retrospectives', '2026-07', '01');
    fs.mkdirSync(retroDir, { recursive: true });
    fs.writeFileSync(path.join(retroDir, '10.00_session.md'),
      '# retro\n\n## Summary\n\nsession body current with enough characters to satisfy the retro parser minimum section length.\n');

    const { sqlite } = createDatabase(dbPath);
    const sourceFile = 'ψ/memory/retrospectives/2026-07/01/10.00_session.md';
    sqlite.prepare(`INSERT INTO oracle_documents
      (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, project, created_by)
      VALUES ('legacy-retro-old-id', 'default', 'retro', ?, '[]', 1, 1, 1, NULL, 'indexer'),
             ('unrelated-doc', 'default', 'learning', 'ψ/memory/learnings/other.md', '[]', 1, 1, 1, NULL, 'indexer')`)
      .run(sourceFile);

    const result = await indexRetrospectives(repoRoot, dbPath);
    expect(result.ok).toBe(true);
    expect(result.documents).toBeGreaterThan(0);

    const legacy = sqlite.prepare("SELECT superseded_by AS s, superseded_at AS a FROM oracle_documents WHERE id = 'legacy-retro-old-id'")
      .get() as { s: string | null; a: number | null };
    expect(legacy.a).not.toBeNull();               // superseded, NOT deleted
    expect(legacy.s).not.toBeNull();
    const successor = sqlite.prepare('SELECT source_file AS f, created_by AS c FROM oracle_documents WHERE id = ?')
      .get(legacy.s) as { f: string; c: string };
    expect(successor.f).toBe(sourceFile);          // superseded by its own replacement
    expect(successor.c).toBe('retro_indexer');

    const unrelated = sqlite.prepare("SELECT superseded_by AS s FROM oracle_documents WHERE id = 'unrelated-doc'")
      .get() as { s: string | null };
    expect(unrelated.s).toBeNull();

    // Idempotent: a second run neither duplicates nor re-supersedes.
    const again = await indexRetrospectives(repoRoot, dbPath);
    expect(again.ok).toBe(true);
    const rows = sqlite.prepare('SELECT COUNT(*) AS c FROM oracle_documents WHERE source_file = ?').get(sourceFile) as { c: number };
    const active = sqlite.prepare('SELECT COUNT(*) AS c FROM oracle_documents WHERE source_file = ? AND superseded_by IS NULL').get(sourceFile) as { c: number };
    expect(active.c).toBe(rows.c - 1);             // exactly the one legacy row stays superseded
  });


  test('cross-tenant: tenant-a reindex never touches tenant-b rows for the same source', async () => {
    const retroDir = path.join(repoRoot, 'ψ', 'memory', 'retrospectives', '2026-07', '02');
    fs.mkdirSync(retroDir, { recursive: true });
    const sourceFile = 'ψ/memory/retrospectives/2026-07/02/09.00_cross.md';
    fs.writeFileSync(path.join(repoRoot, sourceFile),
      '# retro\n\n## Summary\n\ncross tenant body long enough to satisfy the retro parser minimum section length rule.\n');

    const { sqlite } = createDatabase(dbPath);
    sqlite.prepare(`INSERT INTO oracle_documents
      (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, created_by)
      VALUES ('legacy-a', 'tenant-a', 'retro', ?, '[]', 1, 1, 1, 'indexer'),
             ('legacy-b', 'tenant-b', 'retro', ?, '[]', 1, 1, 1, 'indexer')`)
      .run(sourceFile, sourceFile);

    await runWithTenant('tenant-a', () => indexRetrospectives(repoRoot, dbPath));

    const a = sqlite.prepare("SELECT superseded_by AS s FROM oracle_documents WHERE id = 'legacy-a'").get() as { s: string | null };
    const b = sqlite.prepare("SELECT superseded_by AS s FROM oracle_documents WHERE id = 'legacy-b'").get() as { s: string | null };
    expect(a.s).not.toBeNull();   // tenant-a legacy superseded
    expect(b.s).toBeNull();       // tenant-b untouched
  });


  test('ambient-less run scopes to default tenant: tenant-b legacy untouched', async () => {
    const retroDir = path.join(repoRoot, 'ψ', 'memory', 'retrospectives', '2026-07', '03');
    fs.mkdirSync(retroDir, { recursive: true });
    const sourceFile = 'ψ/memory/retrospectives/2026-07/03/08.00_default.md';
    fs.writeFileSync(path.join(repoRoot, sourceFile),
      '# retro\n\n## Summary\n\ndefault tenant body long enough to satisfy the retro parser minimum section length.\n');

    const { sqlite } = createDatabase(dbPath);
    sqlite.prepare(`INSERT INTO oracle_documents
      (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, created_by)
      VALUES ('legacy-default', 'default', 'retro', ?, '[]', 1, 1, 1, 'indexer'),
             ('legacy-b2', 'tenant-b', 'retro', ?, '[]', 1, 1, 1, 'indexer')`)
      .run(sourceFile, sourceFile);

    // No runWithTenant wrapper: ambient tenant undefined => activeTenantId() = 'default'.
    await indexRetrospectives(repoRoot, dbPath);

    const d = sqlite.prepare("SELECT superseded_by AS s FROM oracle_documents WHERE id = 'legacy-default'").get() as { s: string | null };
    const b = sqlite.prepare("SELECT superseded_by AS s FROM oracle_documents WHERE id = 'legacy-b2'").get() as { s: string | null };
    expect(d.s).not.toBeNull();   // default-tenant legacy superseded
    expect(b.s).toBeNull();       // tenant-b untouched even without ambient context
  });
});