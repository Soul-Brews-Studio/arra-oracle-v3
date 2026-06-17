import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-verify-'));
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = join(root, 'oracle.db');

const dbModule = await import('../../../src/db/index.ts');
const appModule = await import('../../../tools/export-app/index.ts');
const exporterModule = await import('../../../tools/export-app/exporter.ts');
const verifyModule = await import('../../../tools/export-app/verify.ts');

const { createDatabase, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const { runExportApp, parseArgs } = appModule;
const { exportOracleData } = exporterModule;
const { verifyExportBundle } = verifyModule;

async function writeBundle(outputDir: string): Promise<void> {
  const connection = createDatabase(join(root, `${outputDir.split('/').pop()}.db`));
  connection.db.insert(oracleDocuments).values({
    id: 'doc-verify', type: 'learning', sourceFile: 'ψ/learn/verify.md',
    concepts: '["backup"]', createdAt: 1, updatedAt: 2, indexedAt: 3,
  }).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'doc-verify', 'Verifier body', 'backup',
  );
  try {
    await exportOracleData({ connection, outputDir, progress: () => {} });
  } finally {
    connection.storage.close();
  }
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(':memory:');
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('export bundle verifier', () => {
  test('passes for a fresh export bundle and the CLI verify flag', async () => {
    const outputDir = join(root, 'ok-bundle');
    await writeBundle(outputDir);

    const verified = await verifyExportBundle(outputDir);
    expect(verified).toMatchObject({ ok: true, errors: [], documentCount: 1, relationshipFileCount: 4 });
    expect(verified.collectionCount).toBeGreaterThan(5);
    expect(verified.checkedFiles).toBeGreaterThan(verified.collectionCount ?? 0);
    expect(verified.bytes).toBeGreaterThan(0);

    const stdout: string[] = [];
    const code = await runExportApp(['--verify', outputDir], (message) => stdout.push(message), () => {});
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ success: true, verified: true, ok: true, documentCount: 1 });
  });

  test('fails when a listed file no longer matches manifest checksums', async () => {
    const outputDir = join(root, 'corrupt-bundle');
    await writeBundle(outputDir);
    writeFileSync(join(outputDir, 'README.md'), `${readFileSync(join(outputDir, 'README.md'), 'utf8')}\ncorrupt`);

    const result = await verifyExportBundle(outputDir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('README.md');
    expect(result.errors.join('\n')).toContain('sha256 mismatch');

    const stdout: string[] = [];
    expect(await runExportApp(['--verify', outputDir], (message) => stdout.push(message), () => {})).toBe(1);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ success: false, verified: false });
  });

  test('fails when a required artifact disappears', async () => {
    const outputDir = join(root, 'missing-bundle');
    await writeBundle(outputDir);
    unlinkSync(join(outputDir, 'relationships.json'));

    const result = await verifyExportBundle(outputDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.includes('relationships.json'))).toBe(true);
  });

  test('parses verify mode without requiring output', () => {
    expect(parseArgs(['--verify', './backup'])).toMatchObject({ verifyDir: './backup' });
    expect(() => parseArgs(['--verify', './backup', '--output', './other']))
      .toThrow('--verify cannot be combined with --output');
  });
});
