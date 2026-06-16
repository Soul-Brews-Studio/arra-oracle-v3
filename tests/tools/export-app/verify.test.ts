import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-verify-'));
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = join(root, 'oracle.db');

const dbModule = await import('../../../src/db/index.ts');
const exporterModule = await import('../../../tools/export-app/exporter.ts');
const appModule = await import('../../../tools/export-app/index.ts');
const verifyModule = await import('../../../tools/export-app/verify.ts');

const { createDatabase, resetDefaultDatabaseForTests } = dbModule;
const { exportOracleData } = exporterModule;
const { runExportApp } = appModule;
const { verifyExportBundle } = verifyModule;

function restoreDbPath(): string {
  return savedDbPath
    ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(restoreDbPath());
  rmSync(root, { recursive: true, force: true });
});

test('export bundle verifier checks manifest file inventory checksums', async () => {
  const connection = createDatabase(join(root, 'verify.db'));
  const outputDir = join(root, 'verify-export');
  try {
    await exportOracleData({ connection, outputDir, progress: () => {} });
  } finally {
    connection.storage.close();
  }

  await expect(verifyExportBundle(outputDir)).resolves.toMatchObject({
    ok: true,
    fileCount: expect.any(Number),
    errors: [],
  });

  writeFileSync(join(outputDir, 'README.md'), 'corrupted export bundle');
  const broken = await verifyExportBundle(outputDir);
  expect(broken.ok).toBe(false);
  expect(broken.errors.some((line) => line.includes('README.md: sha256'))).toBe(true);
});

test('CLI --verify reports structured success and failure', async () => {
  const connection = createDatabase(join(root, 'verify-cli.db'));
  const outputDir = join(root, 'verify-cli-export');
  const stdout: string[] = [];
  try {
    await exportOracleData({ connection, outputDir, progress: () => {} });
  } finally {
    connection.storage.close();
  }

  expect(await runExportApp(['--verify', outputDir], (msg) => stdout.push(msg), () => {})).toBe(0);
  expect(JSON.parse(stdout.join(''))).toMatchObject({ success: true, verified: true });

  stdout.length = 0;
  writeFileSync(join(outputDir, 'README.md'), 'broken');
  expect(await runExportApp(['--verify', outputDir], (msg) => stdout.push(msg), () => {})).toBe(1);
  expect(JSON.parse(stdout.join(''))).toMatchObject({ success: false, verified: false });
});
