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

const { createDatabase, oracleDocuments, traceLog, resetDefaultDatabaseForTests } = dbModule;
const { runExportApp } = appModule;
const { exportOracleData, graphRelationships } = exporterModule;

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
      expect(readFileSync(join(outputDir, 'collections', 'oracle_documents.csv'), 'utf8')).toContain('doc-new');

      const all = JSON.parse(readFileSync(join(outputDir, 'all-collections.json'), 'utf8'));
      expect(all.collections.oracle_documents.map((row: { id: string }) => row.id)).toContain('doc-old');

      const relationships = JSON.parse(readFileSync(join(outputDir, 'relationships.json'), 'utf8'));
      expect(relationships.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'document_superseded_by', from: 'doc-old', to: 'doc-new' }),
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
      trace_log: [{ traceId: 't1', childTraceIds: '["t2"]' }],
    })).toEqual([
      { type: 'document_superseded_by', from: 'a', to: 'b', metadata: { reason: undefined, at: undefined } },
      { type: 'trace_child', from: 't1', to: 't2' },
    ]);
  });
});
