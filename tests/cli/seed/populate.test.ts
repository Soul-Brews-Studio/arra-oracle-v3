import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inArray } from 'drizzle-orm';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const savedDbPath = process.env.ORACLE_DB_PATH;

function restoreDbPath() {
  return savedDbPath
    ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
}

const importRoot = mkdtempSync(join(tmpdir(), 'arra-seed-import-'));
process.env.ORACLE_DATA_DIR = join(importRoot, 'data');
process.env.ORACLE_REPO_ROOT = importRoot;

const dbModule = await import('../../../src/db/index.ts');
const seedModule = await import('../../../src/cli/commands/seed.ts');

const {
  createDatabase,
  learnLog,
  menuItems,
  oracleDocuments,
  resetDefaultDatabaseForTests,
} = dbModule;
const {
  SAMPLE_LEARN_ENTRIES,
  SAMPLE_MENU_ITEMS,
  seedCommand,
  seedDevelopmentData,
} = seedModule;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedRepoRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = savedRepoRoot;
  resetDefaultDatabaseForTests(restoreDbPath());
  rmSync(importRoot, { recursive: true, force: true });
});

function tempConnection() {
  const root = mkdtempSync(join(tmpdir(), 'arra-seed-db-'));
  roots.push(root);
  return createDatabase(join(root, 'oracle.db'));
}

describe('development DB seed command', () => {
  test('populates sample menu and learn entries idempotently', async () => {
    const connection = tempConnection();
    const stdout: string[] = [];
    try {
      const code = await seedCommand([], {
        connection,
        now: () => 1_700_000_000_000,
        stdout: (message) => stdout.push(message),
      });

      expect(code).toBe(0);
      const result = JSON.parse(stdout.join(''));
      expect(result.menu.inserted).toBe(SAMPLE_MENU_ITEMS.length);
      expect(result.learn.documentsInserted).toBe(SAMPLE_LEARN_ENTRIES.length);

      const menuRows = connection.db.select().from(menuItems)
        .where(inArray(menuItems.path, SAMPLE_MENU_ITEMS.map(item => item.path))).all();
      const documentRows = connection.db.select().from(oracleDocuments)
        .where(inArray(oracleDocuments.id, SAMPLE_LEARN_ENTRIES.map(item => item.document.id))).all();
      const logRows = connection.db.select().from(learnLog)
        .where(inArray(learnLog.documentId, SAMPLE_LEARN_ENTRIES.map(item => item.document.id))).all();

      expect(menuRows).toHaveLength(SAMPLE_MENU_ITEMS.length);
      expect(menuRows.every(row => row.source === 'seed')).toBe(true);
      expect(documentRows).toHaveLength(SAMPLE_LEARN_ENTRIES.length);
      expect(documentRows.every(row => row.createdBy === 'seed')).toBe(true);
      expect(logRows).toHaveLength(SAMPLE_LEARN_ENTRIES.length);
      expect(logRows.every(row => row.source === 'seed')).toBe(true);

      const secondRun = seedDevelopmentData(connection, { now: () => 1_700_000_100_000 });
      expect(secondRun.menu.inserted).toBe(0);
      expect(secondRun.menu.updated).toBe(SAMPLE_MENU_ITEMS.length);
      expect(secondRun.learn.documentsInserted).toBe(0);
      expect(secondRun.learn.logsInserted).toBe(0);
      expect(secondRun.learn.logsUpdated).toBe(SAMPLE_LEARN_ENTRIES.length);
      expect(connection.db.select().from(learnLog)
        .where(inArray(learnLog.documentId, SAMPLE_LEARN_ENTRIES.map(item => item.document.id))).all()
      ).toHaveLength(SAMPLE_LEARN_ENTRIES.length);
    } finally {
      connection.storage.close();
    }
  });
});
