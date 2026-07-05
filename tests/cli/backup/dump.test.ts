import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;

const importRoot = mkdtempSync(join(tmpdir(), 'arra-backup-import-'));
process.env.ORACLE_DATA_DIR = join(importRoot, 'data');
process.env.ORACLE_REPO_ROOT = importRoot;

const dbModule = await import('../../../src/db/index.ts');
const backupModule = await import('../../../src/cli/commands/backup.ts');

const { createDatabase, learnLog, menuItems, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const { backupCommand, writeSqliteBackup } = backupModule;

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
  resetDefaultDatabaseForTests(':memory:');
  rmSync(importRoot, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'arra-backup-db-'));
  roots.push(root);
  return root;
}

function populate(connection: ReturnType<typeof createDatabase>): void {
  const createdAt = new Date('2026-01-02T03:04:05.006Z');
  connection.db.insert(menuItems).values({
    path: '/dev/backup',
    label: "Backup's Lab",
    groupKey: 'development',
    position: 930,
    enabled: true,
    access: 'public',
    source: 'test',
    createdAt,
    updatedAt: createdAt,
  }).run();
  connection.db.insert(oracleDocuments).values({
    id: 'backup-doc',
    type: 'learning',
    sourceFile: 'seed://backup.md',
    concepts: JSON.stringify(['backup', 'drizzle']),
    createdAt: 1_766_000_000_000,
    updatedAt: 1_766_000_000_000,
    indexedAt: 1_766_000_000_000,
    createdBy: 'test',
  }).run();
  connection.db.insert(learnLog).values({
    documentId: 'backup-doc',
    patternPreview: 'Drizzle schema metadata can produce SQL dumps.',
    source: 'test',
    concepts: JSON.stringify(['backup']),
    createdAt: 1_766_000_000_000,
  }).run();
}

describe('SQLite backup dump command', () => {
  test('writes a timestamped SQL dump from Drizzle table metadata', async () => {
    const root = tempRoot();
    const connection = createDatabase(join(root, 'oracle.db'));
    const outDir = join(root, 'backups');
    populate(connection);
    try {
      const fixedNow = () => new Date('2026-01-02T03:04:05.006Z');
      const result = await writeSqliteBackup({ connection, outDir, now: fixedNow });
      const stdout: string[] = [];
      const code = await backupCommand([], { connection, outDir, now: fixedNow, stdout: msg => stdout.push(msg) });
      const commandResult = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(existsSync(result.path)).toBe(true);
      expect(basename(result.path)).toBe('arra-oracle-2026-01-02T03-04-05-006Z.sql');
      expect(commandResult.path).toBe(result.path);
      expect(result.tableCount).toBeGreaterThan(5);
      expect(result.rowCount).toBeGreaterThanOrEqual(3);

      const sql = readFileSync(result.path, 'utf8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "menu_items"');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "oracle_documents"');
      expect(sql).toContain('INSERT INTO "menu_items"');
      expect(sql).toContain("Backup''s Lab");
      expect(sql).toContain('INSERT INTO "learn_log"');
      expect(sql).toContain('COMMIT;');
    } finally {
      connection.storage.close();
    }
  });

  test('rejects missing and unknown backup options before opening the DB', async () => {
    const cases = [
      { args: ['--out-dir'], error: 'missing value for --out-dir' },
      { args: ['--out-dir='], error: 'missing value for --out-dir' },
      { args: ['--out-dir', '--json'], error: 'missing value for --out-dir' },
      { args: ['--unknown'], error: 'unknown backup option: --unknown' },
    ];

    for (const item of cases) {
      const stderr: string[] = [];
      const code = await backupCommand(item.args, { stderr: msg => stderr.push(msg) });
      expect(code).toBe(1);
      expect(stderr.join('')).toContain(item.error);
    }
  });
});
