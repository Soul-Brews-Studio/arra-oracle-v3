import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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

const { createDatabase, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const { exportOracleData } = exporterModule;
const { runExportApp } = appModule;
const { verifyExportBundle } = verifyModule;


function seed(connection: ReturnType<typeof createDatabase>): void {
  const now = 1_766_000_000_000;
  connection.db.insert(oracleDocuments).values({
    id: 'verify-doc', type: 'learning', sourceFile: 'psi/export/verify.md',
    concepts: '["verify","backup"]', createdAt: now, updatedAt: now, indexedAt: now, createdBy: 'test',
  }).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'verify-doc', 'Verifier export body.', 'verify backup',
  );
}

async function writeBundle(name: string): Promise<string> {
  const connection = createDatabase(join(root, `${name}.db`));
  const outputDir = join(root, name);
  try {
    seed(connection);
    await exportOracleData({ connection, outputDir, progress: () => {} });
  } finally {
    connection.storage.close();
  }
  return outputDir;
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(':memory:');
  rmSync(root, { recursive: true, force: true });
});

test('export bundle verifier checks inventory checksums and artifacts', async () => {
  const outputDir = await writeBundle('verify-export');
  const verified = await verifyExportBundle(outputDir);
  expect(verified).toMatchObject({ ok: true, errors: [], documentCount: 1, relationshipFileCount: 3 });
  expect(verified.collectionCount).toBeGreaterThan(5);
  expect(verified.checkedFiles).toBeGreaterThan(verified.collectionCount);
  expect(verified.bytes).toBeGreaterThan(0);
  const markdown = join(outputDir, 'documents', 'markdown', 'psi_export_verify.md');
  expect(existsSync(markdown)).toBe(true);

  writeFileSync(markdown, 'tampered');
  const broken = await verifyExportBundle(outputDir);
  expect(broken.ok).toBe(false);
  expect(broken.errors.some((line) => line.includes('checksum mismatch'))).toBe(true);
  unlinkSync(join(outputDir, 'relationships.json'));
  const missing = await verifyExportBundle(outputDir);
  expect(missing.errors.some((line) => line.includes('relationships.json'))).toBe(true);
});

test('CLI --verify reports structured success and failure', async () => {
  const outputDir = await writeBundle('verify-cli-export');
  const stdout: string[] = [];
  expect(await runExportApp(['--verify', outputDir], (msg) => stdout.push(msg), () => {})).toBe(0);
  expect(JSON.parse(stdout.join(''))).toMatchObject({ success: true, verified: true, documentCount: 1 });

  stdout.length = 0;
  writeFileSync(join(outputDir, 'README.md'), 'broken');
  expect(await runExportApp(['--verify', outputDir], (msg) => stdout.push(msg), () => {})).toBe(1);
  expect(JSON.parse(stdout.join(''))).toMatchObject({ success: false, verified: false });
});
