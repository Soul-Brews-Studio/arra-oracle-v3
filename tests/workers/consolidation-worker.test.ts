import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-consolidation-'));
process.env.ORACLE_DATA_DIR = root;

const dbModule = await import('../../src/db/index.ts');
const workerModule = await import('../../src/workers/consolidation.ts');
const { createDatabase, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const { createConsolidationWorker, runConsolidationWorker } = workerModule;

type Connection = ReturnType<typeof createDatabase>;

const now = 1_766_000_000_000;
const duplicateContent = `Oracle install plugin flow quickstart with deploy button and
bun add github package setup. This document explains the same easy install
steps, troubleshooting hints, and plugin activation details for new users.`;

function connection(name: string): Connection {
  return createDatabase(join(root, `${name}.db`));
}

function addDoc(conn: Connection, id: string, tenantId: string, updatedAt: number, content: string) {
  conn.db.insert(oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `docs/${id}.md`,
    concepts: '["install","plugin","quickstart"]',
    createdAt: updatedAt - 10,
    updatedAt,
    indexedAt: updatedAt,
    project: 'github.com/soul-brews-studio/arra-oracle-v3',
    createdBy: 'test',
  }).run();
  conn.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, 'install plugin quickstart');
}

function addDuplicatePair(conn: Connection, tenantId = 'tenant-a') {
  addDoc(conn, 'old-doc', tenantId, now - (70 * 86_400_000), duplicateContent);
  addDoc(conn, 'new-doc', tenantId, now, `${duplicateContent} Updated current guidance.`);
}

function doc(conn: Connection, id: string) {
  return conn.db.select({ id: oracleDocuments.id, supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, id))
    .get();
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(':memory:');
  if (existsSync(root)) rmSync(root, { recursive: true });
});

describe('async consolidation worker', () => {
  test('dry-run plans near duplicates without mutating documents', async () => {
    const conn = connection('dry-run');
    addDuplicatePair(conn);

    try {
      const logs: string[] = [];
      const result = await runConsolidationWorker(conn.db, conn.sqlite, {
        dryRun: true,
        now,
        logger: { log: (line) => logs.push(String(line)), warn: () => {}, error: () => {} },
      });

      expect(result).toMatchObject({ dryRun: true, scanned: 2, planned: 1, applied: 0, deleted: 0 });
      expect(result.plans[0]).toMatchObject({ oldId: 'old-doc', newId: 'new-doc', tenantId: 'tenant-a' });
      expect(logs[0]).toContain('would supersede old-doc -> new-doc');
      expect(doc(conn, 'old-doc')?.supersededBy).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('apply mode uses reversible supersede and never deletes rows', async () => {
    const conn = connection('apply');
    addDuplicatePair(conn);

    try {
      const result = await createConsolidationWorker(conn.db, conn.sqlite, { dryRun: false, now }).runOnce();
      const count = conn.db.select({ id: oracleDocuments.id }).from(oracleDocuments).all().length;

      expect(result).toMatchObject({ dryRun: false, planned: 1, applied: 1, deleted: 0 });
      expect(doc(conn, 'old-doc')?.supersededBy).toBe('new-doc');
      expect(count).toBe(2);
    } finally {
      conn.storage.close();
    }
  });

  test('factory stays off-path until a scheduled/background run fires', () => {
    const conn = connection('off-path');
    addDuplicatePair(conn);
    const worker = createConsolidationWorker(conn.db, conn.sqlite, {
      dryRun: false,
      now,
      intervalMs: 30_000,
    });

    try {
      expect(worker.isRunning()).toBe(false);
      expect(doc(conn, 'old-doc')?.supersededBy).toBeNull();
      worker.start();
      expect(worker.isRunning()).toBe(true);
      expect(doc(conn, 'old-doc')?.supersededBy).toBeNull();
    } finally {
      worker.stop();
      conn.storage.close();
    }
  });

  test('does not plan supersessions across tenants', async () => {
    const conn = connection('tenants');
    addDoc(conn, 'tenant-a-doc', 'tenant-a', now - 1, duplicateContent);
    addDoc(conn, 'tenant-b-doc', 'tenant-b', now, duplicateContent);

    try {
      const result = await runConsolidationWorker(conn.db, conn.sqlite, { dryRun: true, now });
      expect(result.plans).toEqual([]);
    } finally {
      conn.storage.close();
    }
  });

  test('trims tenant filter and scans only that tenant', async () => {
    const conn = connection('tenant-filter');
    addDoc(conn, 'old-a', 'tenant-a', now - (70 * 86_400_000), duplicateContent);
    addDoc(conn, 'new-a', 'tenant-a', now, `${duplicateContent} Updated current guidance.`);
    addDoc(conn, 'old-b', 'tenant-b', now - (70 * 86_400_000), duplicateContent);
    addDoc(conn, 'new-b', 'tenant-b', now, `${duplicateContent} Updated current guidance.`);

    try {
      const result = await runConsolidationWorker(conn.db, conn.sqlite, {
        dryRun: true,
        now,
        tenantId: ' tenant-b ',
      });

      expect(result).toMatchObject({ scanned: 2, planned: 1, applied: 0, deleted: 0 });
      expect(result.plans[0]).toMatchObject({ oldId: 'old-b', newId: 'new-b', tenantId: 'tenant-b' });
    } finally {
      conn.storage.close();
    }
  });

  test('does not widen scans for unsafe numeric options', async () => {
    const conn = connection('unsafe-options');
    addDuplicatePair(conn);

    try {
      const result = await runConsolidationWorker(conn.db, conn.sqlite, {
        dryRun: true,
        limit: -1,
        minCosine: Number.NaN,
        minFtsOverlap: Number.NaN,
        now: Number.NaN,
      });

      expect(result).toMatchObject({ scanned: 0, planned: 0, applied: 0, deleted: 0 });
      expect(doc(conn, 'old-doc')?.supersededBy).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('requires enough lexical evidence before planning supersede', async () => {
    const conn = connection('sparse');
    addDoc(conn, 'a', 'tenant-a', now - 1, 'install plugin');
    addDoc(conn, 'b', 'tenant-a', now, 'install plugin');

    try {
      const result = await runConsolidationWorker(conn.db, conn.sqlite, {
        dryRun: true,
        now,
        minCosine: 0,
        minFtsOverlap: 0,
      });

      expect(result.plans).toEqual([]);
      expect(doc(conn, 'a')?.supersededBy).toBeNull();
    } finally {
      conn.storage.close();
    }
  });
});
