/**
 * arra_supersede must leave an audit row.
 *
 * Until this test, only the HTTP route (`src/routes/supersede/create.ts:46`) wrote
 * `supersede_log`. `runSupersede` — the MCP path — updated `oracle_documents` and returned
 * success without recording anything, so every supersession performed by an agent was invisible
 * to the audit table that exists precisely to record them. Nothing failed; the history was just
 * absent, which is the worst shape for a logging bug.
 *
 * The distinction the log depends on, and the easiest thing to get wrong:
 *   oracle_documents.superseded_by  = the SUCCESSOR DOCUMENT id
 *   supersede_log.superseded_by     = the ACTOR who performed it
 * They share a name and mean different things.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'supersede-log-'));
const ORIGINAL_DATA_DIR = process.env.ORACLE_DATA_DIR;

beforeAll(() => {
  process.env.ORACLE_DATA_DIR = TMP;
});

afterAll(() => {
  if (ORIGINAL_DATA_DIR) process.env.ORACLE_DATA_DIR = ORIGINAL_DATA_DIR;
  else delete process.env.ORACLE_DATA_DIR;
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('arra_supersede writes an audit row', () => {
  test('a successful supersession appends exactly one supersede_log row', async () => {
    const { db, oracleDocuments } = await import('../../db/index.ts');
    const { supersedeLog } = await import('../../db/logistics-schema.ts');
    const { runSupersede } = await import('../supersede.ts');
    const { eq } = await import('drizzle-orm');

    const now = Date.now();
    const oldId = `t_old_${now}`;
    const newId = `t_new_${now}`;

    for (const [id, file] of [[oldId, `ψ/a-${now}.md`], [newId, `ψ/b-${now}.md`]] as const) {
      db.insert(oracleDocuments).values({
        id, type: 'learning', sourceFile: file, project: 'github.com/test/repo',
        concepts: '[]', createdAt: now, updatedAt: now, indexedAt: now,
      }).run();
    }

    const before = db.select().from(supersedeLog).all().length;
    const result = runSupersede(db, { oldId, newId, reason: 'audit-row test' });
    expect((result.payload as { success: boolean }).success).toBe(true);

    const rows = db.select().from(supersedeLog).all();
    expect(rows.length).toBe(before + 1);

    const row = rows.find((r) => r.oldId === oldId);
    expect(row).toBeDefined();
    expect(row!.newId).toBe(newId);
    expect(row!.reason).toBe('audit-row test');
    expect(row!.oldPath).toBe(`ψ/a-${now}.md`);        // notNull — must be a real path
    expect(row!.newPath).toBe(`ψ/b-${now}.md`);
    expect(row!.project).toBe('github.com/test/repo');
    expect(row!.supersededAt).toBeGreaterThan(0);

    // The actor, NOT the successor id. Writing newId here would silently corrupt the audit
    // trail into a duplicate of a column oracle_documents already holds.
    expect(row!.supersededBy).toBe('mcp');
    expect(row!.supersededBy).not.toBe(newId);

    // and the document itself still records the successor, unchanged by the logging
    const doc = db.select().from(oracleDocuments).where(eq(oracleDocuments.id, oldId)).get();
    expect(doc?.supersededBy).toBe(newId);
  });

  test('an already-superseded no-op does not append a second row', async () => {
    const { db, oracleDocuments } = await import('../../db/index.ts');
    const { supersedeLog } = await import('../../db/logistics-schema.ts');
    const { runSupersede } = await import('../supersede.ts');

    const now = Date.now();
    const oldId = `t_noop_old_${now}`;
    const newId = `t_noop_new_${now}`;
    for (const [id, file] of [[oldId, `ψ/c-${now}.md`], [newId, `ψ/d-${now}.md`]] as const) {
      db.insert(oracleDocuments).values({
        id, type: 'learning', sourceFile: file,
        concepts: '[]', createdAt: now, updatedAt: now, indexedAt: now,
      }).run();
    }

    runSupersede(db, { oldId, newId, reason: 'first' });
    const afterFirst = db.select().from(supersedeLog).all().length;

    // repeating the same supersession is a no-op; it must not double-log
    const again = runSupersede(db, { oldId, newId, reason: 'second' });
    expect((again.payload as { unchanged?: boolean }).unchanged).toBe(true);
    expect(db.select().from(supersedeLog).all().length).toBe(afterFirst);
  });
});

test('the temp data dir was actually used, not the real one', () => {
  expect(process.env.ORACLE_DATA_DIR).toBe(TMP);
  expect(existsSync(TMP)).toBe(true);
});
