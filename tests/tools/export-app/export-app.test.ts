import { afterAll, describe, expect, test } from 'bun:test';
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
const { exportOracleData, graphRelationships } = exporterModule;
const { formatCsvCollection } = csvModule;
const { formatJsonCollection } = jsonModule;

function restoreDbPath() {
  return savedDbPath
    ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
}

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
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(restoreDbPath());
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

      const relationships = JSON.parse(readFileSync(join(outputDir, 'relationships.json'), 'utf8'));
      expect(relationships.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'document_superseded_by', from: 'doc-old', to: 'doc-new' }),
        expect.objectContaining({ type: 'supersede_log', from: 'doc-old', to: 'doc-new' }),
        expect.objectContaining({ type: 'trace_next', from: 'trace-a', to: 'trace-b' }),
      ]));
    } finally {
      connection.storage.close();
    }
  });

  test('CLI writes a success summary and progress output', async () => {
    const outputDir = join(root, 'backup-cli');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runExportApp(['--output', outputDir, '--db', dbPath], (msg) => stdout.push(msg), (msg) => stderr.push(msg));

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).success).toBe(true);
    expect(stderr.join('')).toContain('oracle_documents');
    expect(existsSync(join(outputDir, 'manifest.json'))).toBe(true);
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
