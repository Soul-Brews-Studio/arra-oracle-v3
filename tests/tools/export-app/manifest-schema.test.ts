import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-schema-'));
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = join(root, 'oracle.db');

const dbModule = await import('../../../src/db/index.ts');
const exporterModule = await import('../../../tools/export-app/exporter.ts');

const { createDatabase, resetDefaultDatabaseForTests } = dbModule;
const { exportOracleData, EXPORT_MANIFEST_SCHEMA } = exporterModule;

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

test('writes a manifest JSON schema with required export fields', async () => {
  const connection = createDatabase(join(root, 'schema.db'));
  const outputDir = join(root, 'schema-export');

  try {
    await exportOracleData({
      connection,
      outputDir,
      progress: () => {},
      now: () => new Date('2026-01-02T03:04:05.006Z'),
    });
  } finally {
    connection.storage.close();
  }

  const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
  const schema = JSON.parse(readFileSync(join(outputDir, 'manifest.schema.json'), 'utf8'));
  expect(schema).toEqual(EXPORT_MANIFEST_SCHEMA);
  expect(schema.required).toEqual(Object.keys(manifest));
  expect(schema.properties.formats.items.enum).toEqual(['json', 'csv', 'markdown']);
  expect(manifest.files).toContainEqual(expect.objectContaining({
    path: 'manifest.schema.json',
    bytes: expect.any(Number),
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  }));
  expect(manifest.files.some((file: { path: string }) => file.path === 'manifest.json')).toBe(false);
  expect(schema.properties.files.items.properties.sha256.pattern).toBe('^[a-f0-9]{64}$');
});
