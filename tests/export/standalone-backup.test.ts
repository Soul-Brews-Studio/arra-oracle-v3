import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-standalone-'));
const dbPath = join(root, 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbModule = await import('../../src/db/index.ts');
const exporterModule = await import('../../tools/export-app/exporter.ts');
const verifyModule = await import('../../tools/export-app/verify.ts');

const { createDatabase, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const { exportOracleData } = exporterModule;
const { verifyExportBundle } = verifyModule;

function seed(connection: ReturnType<typeof createDatabase>): void {
  const now = 1_766_000_000_000;
  connection.db.insert(oracleDocuments).values([
    {
      id: 'doc-old', type: 'learning', sourceFile: 'ψ/export/old.md',
      concepts: '["backup"]', createdAt: now, updatedAt: now,
      indexedAt: now, supersededBy: 'doc-new', supersededReason: 'refresh',
    },
    {
      id: 'doc-new', type: 'learning', sourceFile: 'ψ/export/new.md',
      concepts: '["safe"]', createdAt: now + 1, updatedAt: now + 1,
      indexedAt: now + 1,
    },
  ]).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'doc-old',
    'Old body for standalone backup.',
    'backup',
  );
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(':memory:');
  rmSync(root, { recursive: true, force: true });
});

describe('standalone export backup bundle', () => {
  test('writes all collection formats plus a restorable SQL backup dump', async () => {
    const connection = createDatabase(dbPath);
    const outputDir = join(root, 'bundle');
    seed(connection);

    try {
      const result = await exportOracleData({
        connection,
        outputDir,
        collections: ['oracle_documents'],
        progress: () => {},
        now: () => new Date('2026-01-02T03:04:05.006Z'),
      });

      expect(result).toMatchObject({ collectionCount: 1, rowCount: 2, documentCount: 2 });
      for (const ext of ['json', 'jsonl', 'csv', 'md']) {
        expect(existsSync(join(outputDir, 'collections', `oracle_documents.${ext}`))).toBe(true);
        expect(existsSync(join(outputDir, `relationships.${ext}`))).toBe(true);
      }

      const lines = readFileSync(join(outputDir, 'collections', 'oracle_documents.jsonl'), 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as { id: string });
      expect(lines.map((line) => line.id).sort()).toEqual(['doc-new', 'doc-old']);

      const backup = readFileSync(join(outputDir, 'backup.sql'), 'utf8');
      expect(backup).toContain('CREATE TABLE IF NOT EXISTS "oracle_documents"');
      expect(backup).toContain("INSERT INTO \"oracle_documents\"");
      expect(backup).toContain('doc-old');

      const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8')) as Record<string, any>;
      expect(manifest.formats).toEqual(['json', 'jsonl', 'csv', 'markdown']);
      expect(manifest.backup).toEqual({ path: 'backup.sql', tableCount: 1, rowCount: 2 });
      expect(manifest.files.map((entry: { path: string }) => entry.path)).toContain('backup.sql');

      const verified = await verifyExportBundle(outputDir);
      expect(verified).toMatchObject({ ok: true, errors: [], documentCount: 2, relationshipFileCount: 4 });
    } finally {
      connection.storage.close();
    }
  });
});
