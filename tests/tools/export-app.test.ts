import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-app-'));
const defaultDbPath = join(root, 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = defaultDbPath;

const dbModule = await import('../../src/db/index.ts');
const appModule = await import('../../tools/export-app/index.ts');
const exporterModule = await import('../../tools/export-app/exporter.ts');

const { createDatabase, oracleDocuments, oracleMemories, resetDefaultDatabaseForTests } = dbModule;
const { parseArgs, runExportApp } = appModule;
const { exportMarkdownData, schemaTables } = exporterModule;

function restoreDbPath(): string {
  return savedDbPath
    ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
}

function seed(connection: ReturnType<typeof createDatabase>): void {
  const now = 1_766_000_000_000;
  connection.db.insert(oracleDocuments).values([
    {
      id: 'doc-old', type: 'learning', sourceFile: 'psi/learn/old.md', concepts: '["backup"]',
      createdAt: now, updatedAt: now + 1, indexedAt: now + 2, createdBy: 'test',
    },
    {
      id: 'doc-new', type: 'learning', sourceFile: 'psi/learn/new.md', concepts: '["safe"]',
      createdAt: now + 3, updatedAt: now + 4, indexedAt: now + 5, createdBy: 'test',
    },
  ]).run();
  connection.db.insert(oracleMemories).values({
    id: 'mem-1',
    content: 'Memory export body',
    title: 'Export memory',
    createdAt: now,
    updatedAt: now,
  }).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'doc-old',
    'Old export body',
    'backup',
  );
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'doc-new',
    'New export body',
    'safe',
  );
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(restoreDbPath());
  rmSync(root, { recursive: true, force: true });
});

test('exports every schema collection as per-row markdown with frontmatter', async () => {
  const connection = createDatabase(join(root, 'direct.db'));
  const outputDir = join(root, 'direct-export');
  const progress: string[] = [];
  seed(connection);

  try {
    const result = await exportMarkdownData({
      connection,
      outputDir,
      progress: (message) => progress.push(message),
    });

    expect(result.collectionCount).toBe(schemaTables().length);
    expect(result.fileCount).toBeGreaterThanOrEqual(3);
    expect(progress.some((line) => line.includes('oracle_documents'))).toBe(true);

    const docFiles = readdirSync(join(outputDir, 'oracle_documents'));
    expect(docFiles).toEqual(expect.arrayContaining(['doc-old.md', 'doc-new.md']));

    const doc = readFileSync(join(outputDir, 'oracle_documents', 'doc-old.md'), 'utf8');
    expect(doc.startsWith('---\n')).toBe(true);
    expect(doc).toContain('id: "doc-old"');
    expect(doc).toContain('collection: "oracle_documents"');
    expect(doc).toContain('timestamps:\n  createdAt: 1766000000000');
    expect(doc).toContain('"sourceFile": "psi/learn/old.md"');
    expect(readFileSync(join(outputDir, 'oracle_memories', 'mem-1.md'), 'utf8'))
      .toContain('Memory export body');
  } finally {
    connection.storage.close();
  }
});

test('CLI exports document markdown and JSON from --db without starting the server', async () => {
  const dbPath = join(root, 'cli.db');
  const outputDir = join(root, 'cli-export');
  const connection = createDatabase(dbPath);
  seed(connection);
  connection.storage.close();

  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runExportApp(
    ['--output', outputDir, '--db', dbPath],
    (message) => stdout.push(message),
    (message) => stderr.push(message),
  );

  expect(code).toBe(0);
  expect(JSON.parse(stdout.join('')).success).toBe(true);
  expect(stderr.join('')).toContain('oracle_documents');
  expect(existsSync(join(outputDir, 'documents', 'markdown', 'psi_learn_new.md'))).toBe(true);
  expect(existsSync(join(outputDir, 'documents', 'json', 'psi_learn_new.json'))).toBe(true);
  expect(readFileSync(join(outputDir, 'documents', 'markdown', 'psi_learn_new.md'), 'utf8'))
    .toContain('New export body');
});

test('CLI quiet flag suppresses progress output', async () => {
  const dbPath = join(root, 'quiet.db');
  const outputDir = join(root, 'quiet-export');
  const connection = createDatabase(dbPath);
  seed(connection);
  connection.storage.close();

  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runExportApp(
    ['--output', outputDir, '--db', dbPath, '--quiet'],
    (message) => stdout.push(message),
    (message) => stderr.push(message),
  );

  expect(code).toBe(0);
  expect(JSON.parse(stdout.join('')).success).toBe(true);
  expect(stderr.join('')).toBe('');
  expect(existsSync(join(outputDir, 'manifest.json'))).toBe(true);
});

test('CLI rejects unknown flags before exporting', () => {
  expect(() => parseArgs(['--output', './backup', '--bogus'])).toThrow('unknown flag: --bogus');
  expect(() => parseArgs(['--output'])).toThrow('missing value for --output');
});
