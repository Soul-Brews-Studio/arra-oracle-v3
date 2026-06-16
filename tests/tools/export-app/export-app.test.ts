import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-app-'));
const dbPath = join(root, 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbModule = await import('../../../src/db/index.ts');
const appModule = await import('../../../tools/export-app/index.ts');
const exporterModule = await import('../../../tools/export-app/exporter.ts');
const csvModule = await import('../../../tools/export-app/format-csv.ts');
const jsonModule = await import('../../../tools/export-app/format-json.ts');

const { createDatabase, oracleDocuments, supersedeLog, traceLog, resetDefaultDatabaseForTests } = dbModule;
const { runExportApp } = appModule;
const { exportOracleData, exportOracleV2Documents, graphRelationships } = exporterModule;
const { formatCsvCollection } = csvModule;
const { formatJsonCollection } = jsonModule;


function seed(connection: ReturnType<typeof createDatabase>) {
  const now = 1_766_000_000_000;
  connection.db.insert(oracleDocuments).values([
    {
      id: 'doc-old', type: 'learning', sourceFile: 'ψ/learn/old.md', concepts: '["backup"]',
      createdAt: now, updatedAt: now, indexedAt: now, supersededBy: 'doc-new', supersededReason: 'refresh', createdBy: 'test',
    },
    {
      id: 'doc-new', type: 'learning', sourceFile: 'ψ/learn/new.md', concepts: '["backup","safe"]',
      createdAt: now + 1, updatedAt: now + 1, indexedAt: now + 1, createdBy: 'test',
    },
  ]).run();
  connection.db.insert(traceLog).values([
    { traceId: 'trace-a', query: 'backup root', childTraceIds: '["trace-b"]', nextTraceId: 'trace-b', createdAt: now, updatedAt: now },
    { traceId: 'trace-b', query: 'backup child', parentTraceId: 'trace-a', prevTraceId: 'trace-a', createdAt: now, updatedAt: now },
  ]).run();
  connection.db.insert(supersedeLog).values({
    oldPath: 'ψ/learn/old.md', oldId: 'doc-old', oldTitle: 'Old',
    newPath: 'ψ/learn/new.md', newId: 'doc-new', newTitle: 'New',
    reason: 'refresh', supersededAt: now + 2, supersededBy: 'test', project: 'demo',
  }).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'doc-old',
    '# Old body\n\nLegacy Oracle v2 content.',
    'backup',
  );
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'doc-new',
    '# New body\n\nSafe export content.',
    'backup safe',
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

describe('standalone export app', () => {
  test('exports every Drizzle collection as json, csv, markdown plus graph relationships', async () => {
    const connection = createDatabase(dbPath);
    const outputDir = join(root, 'backup');
    const progress: string[] = [];
    seed(connection);

    try {
      const result = await exportOracleData({ connection, outputDir, progress: (message) => progress.push(message), now: () => new Date('2026-01-02T03:04:05.006Z') });

      expect(result.collectionCount).toBeGreaterThan(5);
      expect(result.rowCount).toBeGreaterThanOrEqual(4);
      expect(result.relationshipCount).toBeGreaterThanOrEqual(4);
      expect(result.documentCount).toBe(2);
      expect(progress.some((line) => line.includes('oracle_documents'))).toBe(true);

      for (const ext of ['json', 'csv', 'md']) expect(existsSync(join(outputDir, 'collections', `oracle_documents.${ext}`))).toBe(true);
      expect(readFileSync(join(outputDir, 'collections', 'oracle_documents.md'), 'utf8')).toContain('doc-old');
      const csv = readFileSync(join(outputDir, 'collections', 'oracle_documents.csv'), 'utf8');
      expect(csv.split('\n')[0]).toBe('id,title,content_preview,collection,created_at');
      expect(csv).toContain('"doc-new"');

      const documentsJson = JSON.parse(readFileSync(join(outputDir, 'collections', 'oracle_documents.json'), 'utf8'));
      expect(documentsJson).toMatchObject({ collection: 'oracle_documents', rowCount: 2 });
      const all = JSON.parse(readFileSync(join(outputDir, 'all-collections.json'), 'utf8'));
      expect(all.collections.oracle_documents.map((row: { id: string }) => row.id)).toContain('doc-old');
      const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
      const exportedFile = manifest.files.find(
        (entry: { path: string }) => entry.path === 'documents/markdown/learn_old.md',
      );
      expect(exportedFile.bytes).toBeGreaterThan(0);
      expect(exportedFile.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.files.map((entry: { path: string }) => entry.path)).toContain('all-collections.json');
      expect(manifest.files.map((entry: { path: string }) => entry.path)).toContain('README.md');
      const bundleReadme = readFileSync(join(outputDir, 'README.md'), 'utf8');
      expect(bundleReadme).toContain('Documents: 2');

      const relationships = JSON.parse(readFileSync(join(outputDir, 'relationships.json'), 'utf8'));
      expect(relationships.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'document_superseded_by', from: 'doc-old', to: 'doc-new' }),
        expect.objectContaining({ type: 'supersede_log', from: 'doc-old', to: 'doc-new' }),
        expect.objectContaining({ type: 'trace_next', from: 'trace-a', to: 'trace-b' }),
      ]));

      const markdown = readFileSync(join(outputDir, 'documents', 'markdown', 'learn_old.md'), 'utf8');
      expect(markdown).toContain('source_file: "ψ/learn/old.md"');
      expect(markdown).toContain('Legacy Oracle v2 content.');
      const docJson = JSON.parse(readFileSync(join(outputDir, 'documents', 'json', 'learn_old.json'), 'utf8'));
      expect(docJson).toMatchObject({
        id: 'doc-old',
        source: 'ψ/learn/old.md',
        content: expect.stringContaining('Legacy Oracle v2 content.'),
        concepts: ['backup'],
      });
      expect(docJson.metadata).toMatchObject({ source_file: 'ψ/learn/old.md', concepts: ['backup'] });
      const docCsv = readFileSync(join(outputDir, 'documents', 'documents.csv'), 'utf8');
      expect(docCsv).toContain('id,source,type,concepts,content_preview,metadata_json');
      expect(docCsv).toContain('"doc-old","ψ/learn/old.md","learning","backup"');
    } finally {
      connection.storage.close();
    }
  });

  test('CLI writes document markdown/json files and progress output', async () => {
    const outputDir = join(root, 'backup-cli');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runExportApp(['--output', outputDir, '--db', dbPath], (msg) => stdout.push(msg), (msg) => stderr.push(msg));

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).success).toBe(true);
    expect(stderr.join('')).toContain('oracle_documents');
    expect(existsSync(join(outputDir, 'documents', 'markdown', 'learn_new.md'))).toBe(true);
    expect(existsSync(join(outputDir, 'documents', 'json', 'learn_new.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'documents', 'documents.csv'))).toBe(true);
    expect(existsSync(join(outputDir, 'collections', 'oracle_documents.json'))).toBe(true);
  });

  test('CLI filters batch exports to selected collections', async () => {
    const filterDbPath = join(root, 'filter.db');
    const outputDir = join(root, 'backup-filter');
    const connection = createDatabase(filterDbPath);
    const stdout: string[] = [];
    seed(connection);
    connection.storage.close();

    const code = await runExportApp(
      ['--output', outputDir, '--db', filterDbPath, '--collection', 'oracle_documents'],
      (msg) => stdout.push(msg),
      () => {},
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).collectionCount).toBe(1);
    expect(existsSync(join(outputDir, 'collections', 'oracle_documents.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'collections', 'trace_log.json'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.collections)).toEqual(['oracle_documents']);
  });

  test('document engine reads a legacy Oracle v2 database with only docs and FTS', async () => {
    const legacyDbPath = join(root, 'legacy-v2.db');
    const legacyOutput = join(root, 'legacy-v2-export');
    const sqlite = new Database(legacyDbPath);
    sqlite.exec(`
      CREATE TABLE oracle_documents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source_file TEXT NOT NULL,
        concepts TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
    `);
    sqlite.prepare('INSERT INTO oracle_documents VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'legacy-doc',
      'learning',
      'ψ/legacy/export.md',
      '["legacy","backup"]',
      1,
      2,
      3,
    );
    sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
      'legacy-doc',
      'Legacy body from old Oracle v2.',
      'legacy backup',
    );
    sqlite.close();

    const result = await exportOracleV2Documents({ dbPath: legacyDbPath, outputDir: legacyOutput });
    expect(result.documentCount).toBe(1);
    expect(readFileSync(result.csvPath, 'utf8')).toContain('"legacy-doc","ψ/legacy/export.md"');
    expect(readFileSync(join(legacyOutput, 'documents', 'markdown', 'legacy_export.md'), 'utf8'))
      .toContain('Legacy body from old Oracle v2.');
    const payload = JSON.parse(readFileSync(join(legacyOutput, 'documents', 'json', 'legacy_export.json'), 'utf8'));
    expect(payload.metadata).toMatchObject({ source_file: 'ψ/legacy/export.md', concepts: ['legacy', 'backup'] });
  });

  test('graph relationship extraction is deterministic for rows', () => {
    expect(graphRelationships({
      oracle_documents: [{ id: 'a', supersededBy: 'b' }],
      supersede_log: [{ oldId: 'b', newId: 'c', oldPath: 'old.md', newPath: 'new.md', reason: 'rename', supersededAt: 2 }],
      trace_log: [{ traceId: 't1', childTraceIds: '["t2"]' }],
    })).toEqual([
      { type: 'document_superseded_by', from: 'a', to: 'b', metadata: { reason: undefined, at: undefined } },
      { type: 'supersede_log', from: 'b', to: 'c', metadata: { oldPath: 'old.md', newPath: 'new.md', reason: 'rename', at: 2, by: undefined, project: undefined } },
      { type: 'trace_child', from: 't1', to: 't2' },
    ]);
  });

  test('json formatter keeps full metadata and embeddings', () => {
    const payload = JSON.parse(formatJsonCollection('vectors', [
      { id: 'vec-1', title: 'Vector row', metadata: { source: 'test' }, embeddings: [0.1, 0.2] },
    ]));

    expect(payload).toEqual({
      collection: 'vectors',
      rowCount: 1,
      rows: [{ id: 'vec-1', title: 'Vector row', metadata: { source: 'test' }, embeddings: [0.1, 0.2] }],
    });
  });

  test('csv formatter writes the fixed tabular export view', () => {
    expect(formatCsvCollection('oracle_documents', [
      { id: 'doc-1', title: 'Doc', content: 'Line one\nline two', createdAt: 7 },
    ])).toBe('id,title,content_preview,collection,created_at\n"doc-1","Doc","Line one line two","oracle_documents","7"\n');
  });
});
