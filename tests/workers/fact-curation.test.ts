import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FactCurationResult } from '../../src/workers/fact-curation.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), 'arra-fact-curation-'));
process.env.ORACLE_DATA_DIR = root;

const dbModule = await import('../../src/db/index.ts');
const { createDatabase, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const { runConsolidationWorker } = await import('../../src/workers/consolidation.ts');

type Connection = ReturnType<typeof createDatabase>;
type CurationRun = Awaited<ReturnType<typeof runConsolidationWorker>> & { factCuration: FactCurationResult };

const now = 1_766_000_000_000;
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const curation = { limit: 10, topK: 2, minSimilarity: 0.2, minOverlap: 0.2, minNoveltyTokens: 2, logger: quiet };

function connection(name: string): Connection {
  return createDatabase(join(root, `${name}.db`));
}

function addDoc(conn: Connection, id: string, tenantId: string, updatedAt: number, content: string) {
  conn.db.insert(oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `docs/${id}.md`,
    concepts: '["fact","curation","memory"]',
    createdAt: updatedAt - 10,
    updatedAt,
    indexedAt: updatedAt,
    project: 'github.com/soul-brews-studio/arra-oracle-v3',
    createdBy: 'test',
  }).run();
  conn.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, 'fact curation memory');
}

function seed(conn: Connection, tenantId = 'tenant-a', suffix = '') {
  addDoc(conn, `old-router${suffix}`, tenantId, now - 100, 'Search routes use Hono middleware for router auth and request guards.');
  addDoc(conn, `new-router${suffix}`, tenantId, now, 'Search routes use Elysia middleware for router auth and request guards. Elysia TypeBox schemas are current.');
  const plugin = 'Plugin install uses bun add from GitHub package and code plugin install flow.';
  addDoc(conn, `plugin-canonical${suffix}`, tenantId, now - 300, plugin);
  addDoc(conn, `plugin-duplicate${suffix}`, tenantId, now - 200, plugin);
  addDoc(conn, `unique-fact${suffix}`, tenantId, now - 400, 'Vector health dashboard shows providers services storage freshness.');
}

function supersededBy(conn: Connection, id: string) {
  return conn.db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, id))
    .get()?.supersededBy;
}

async function run(conn: Connection, dryRun: boolean, tenantId?: string): Promise<CurationRun> {
  return await runConsolidationWorker(conn.db, conn.sqlite, {
    dryRun,
    limit: 0,
    tenantId,
    logger: quiet,
    factCuration: curation,
  }) as CurationRun;
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  resetDefaultDatabaseForTests(':memory:');
  if (existsSync(root)) rmSync(root, { recursive: true });
});

describe('active fact-curation consolidation pass', () => {
  test('dry-run emits ADD, UPDATE, and NOOP decisions without mutating rows', async () => {
    const conn = connection('dry-run');
    seed(conn);

    try {
      const result = await run(conn, true);
      const byTarget = Object.fromEntries(result.factCuration.decisions.map((decision) => [decision.targetId, decision]));

      expect(result).toMatchObject({ dryRun: true, scanned: 0, planned: 2, applied: 0, deleted: 0 });
      expect(result.factCuration).toMatchObject({ enabled: true, scanned: 5, planned: 2, applied: 0, deleted: 0 });
      expect(byTarget['new-router']).toMatchObject({ action: 'UPDATE', supersede: { oldId: 'old-router', newId: 'new-router' } });
      expect(byTarget['plugin-duplicate']).toMatchObject({ action: 'NOOP', supersede: { oldId: 'plugin-duplicate', newId: 'plugin-canonical' } });
      expect(byTarget['unique-fact']).toMatchObject({ action: 'ADD', similarIds: [] });
      expect(supersededBy(conn, 'old-router')).toBeNull();
      expect(supersededBy(conn, 'plugin-duplicate')).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('apply mode maps UPDATE and NOOP to reversible supersede edges', async () => {
    const conn = connection('apply');
    seed(conn);

    try {
      const result = await run(conn, false);
      const count = conn.db.select({ id: oracleDocuments.id }).from(oracleDocuments).all().length;

      expect(result.factCuration).toMatchObject({ planned: 2, applied: 2, skipped: 0, deleted: 0 });
      expect(supersededBy(conn, 'old-router')).toBe('new-router');
      expect(supersededBy(conn, 'plugin-duplicate')).toBe('plugin-canonical');
      expect(count).toBe(5);
    } finally {
      conn.storage.close();
    }
  });

  test('tenant filter keeps top-k decisions inside the requested tenant', async () => {
    const conn = connection('tenant-filter');
    seed(conn, 'tenant-a', '-a');
    seed(conn, 'tenant-b', '-b');

    try {
      const result = await run(conn, false, ' tenant-b ');

      expect(result.factCuration).toMatchObject({ scanned: 5, planned: 2, applied: 2 });
      expect(supersededBy(conn, 'old-router-a')).toBeNull();
      expect(supersededBy(conn, 'old-router-b')).toBe('new-router-b');
      expect(supersededBy(conn, 'plugin-duplicate-b')).toBe('plugin-canonical-b');
    } finally {
      conn.storage.close();
    }
  });
});
