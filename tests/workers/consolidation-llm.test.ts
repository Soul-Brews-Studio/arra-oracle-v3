import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), 'arra-consolidation-llm-'));
process.env.ORACLE_DATA_DIR = root;

const dbModule = await import('../../src/db/index.ts');
const { createDatabase, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const { createConsolidationWorker, runConsolidationWorker } = await import('../../src/workers/consolidation.ts');

type Connection = ReturnType<typeof createDatabase>;
type LlmResult = Awaited<ReturnType<typeof runConsolidationWorker>> & {
  llm: { enabled: boolean; pairs: number; planned: number; applied: number; skipped: number; calls: unknown[] };
};

const now = 1_766_000_000_000;

function connection(name: string): Connection {
  return createDatabase(join(root, `${name}.db`));
}

function addDoc(conn: Connection, id: string, updatedAt: number, content: string) {
  conn.db.insert(oracleDocuments).values({
    id,
    tenantId: 'tenant-a',
    type: 'learning',
    sourceFile: `docs/${id}.md`,
    concepts: '["router","framework"]',
    createdAt: updatedAt - 10,
    updatedAt,
    indexedAt: updatedAt,
    project: 'github.com/soul-brews-studio/arra-oracle-v3',
    createdBy: 'test',
  }).run();
  conn.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, 'router framework');
}

function addContradictionPair(conn: Connection) {
  addDoc(conn, 'old-router-fact', now - 1000, 'Search routes use Hono middleware for router auth.');
  addDoc(conn, 'new-router-fact', now, 'Search routes use Elysia middleware for router auth.');
}

function supersededBy(conn: Connection, id: string) {
  return conn.db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, id))
    .get()?.supersededBy;
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  resetDefaultDatabaseForTests(':memory:');
  if (existsSync(root)) rmSync(root, { recursive: true });
});

describe('LLM consolidation supersede layer', () => {
  test('stays opt-in and does not call the LLM when disabled', async () => {
    const conn = connection('disabled');
    addContradictionPair(conn);
    let called = false;

    try {
      const result = await runConsolidationWorker(conn.db, conn.sqlite, {
        dryRun: true,
        now,
        llm: { enabled: false, client: async () => { called = true; return { calls: [] }; } },
      }) as LlmResult;

      expect(called).toBe(false);
      expect(result.llm).toMatchObject({ enabled: false, planned: 0, applied: 0 });
      expect(supersededBy(conn, 'old-router-fact')).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('dry-run accepts only SUPERSEDE calls from the LLM', async () => {
    const conn = connection('dry-run');
    addContradictionPair(conn);

    try {
      const result = await createConsolidationWorker(conn.db, conn.sqlite, {
        dryRun: true,
        now,
        minCosine: 1,
        minFtsOverlap: 1,
        llm: {
          enabled: true,
          minSharedTokens: 1,
          client: async () => ({
            calls: [
              { action: 'DELETE', oldId: 'old-router-fact', reason: 'unsafe' },
              { action: 'SUPERSEDE', oldId: 'missing', newId: 'new-router-fact', reason: 'bad id' },
              { action: 'SUPERSEDE', oldId: 'old-router-fact', newId: 'new-router-fact', reason: 'Elysia replaces Hono' },
            ],
          }),
        },
      }).runOnce() as LlmResult;

      expect(result).toMatchObject({ dryRun: true, planned: 1, applied: 0, deleted: 0 });
      expect(result.llm).toMatchObject({ enabled: true, pairs: 1, planned: 1, applied: 0, skipped: 1 });
      expect(result.plans[0].reason).toContain('LLM contradiction consolidation');
      expect(supersededBy(conn, 'old-router-fact')).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('apply mode uses reversible supersede and never deletes rows', async () => {
    const conn = connection('apply');
    addContradictionPair(conn);

    try {
      const result = await runConsolidationWorker(conn.db, conn.sqlite, {
        dryRun: false,
        now,
        minCosine: 1,
        minFtsOverlap: 1,
        llm: {
          enabled: true,
          minSharedTokens: 1,
          client: async () => JSON.stringify({
            calls: [{ action: 'SUPERSEDE', oldId: 'old-router-fact', newId: 'new-router-fact', reason: 'newer framework fact' }],
          }),
        },
      }) as LlmResult;
      const count = conn.db.select({ id: oracleDocuments.id }).from(oracleDocuments).all().length;

      expect(result.llm).toMatchObject({ planned: 1, applied: 1, skipped: 0 });
      expect(supersededBy(conn, 'old-router-fact')).toBe('new-router-fact');
      expect(count).toBe(2);
      expect(result.deleted).toBe(0);
    } finally {
      conn.storage.close();
    }
  });
});
