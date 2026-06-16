import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-stats-'));
const dbPath = join(root, 'oracle.db');
const exportDir = join(root, 'export-app');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbModule = await import('../../../src/db/index.ts');
const { Elysia } = await import('elysia');
const { createApiVersionedFetch } = await import('../../../src/middleware/api-version.ts');
const { createExportStatsRoutes, formatExportSize } = await import('../../../src/routes/export/stats.ts');
const { exportAppRoutes } = await import('../../../src/routes/export/app.ts');

const { createDatabase, oracleDocuments, supersedeLog, traceLog, resetDefaultDatabaseForTests } = dbModule;
const connection = createDatabase(dbPath);
const lastExport = new Date('2026-02-03T04:05:06.007Z');

function restoreDbPath() {
  return savedDbPath ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
}

function seed() {
  const now = 1_766_000_000_000;
  connection.db.insert(oracleDocuments).values([
    { id: 'doc-a', type: 'learning', sourceFile: 'psi/a.md', concepts: '[]', createdAt: now, updatedAt: now, indexedAt: now, createdBy: 'test' },
    { id: 'doc-b', type: 'learning', sourceFile: 'psi/b.md', concepts: '[]', createdAt: now, updatedAt: now, indexedAt: now, createdBy: 'test' },
  ]).run();
  connection.db.insert(traceLog).values([
    { traceId: 'trace-a', query: 'root', childTraceIds: '["trace-b"]', nextTraceId: 'trace-b', createdAt: now, updatedAt: now },
    { traceId: 'trace-b', query: 'child', parentTraceId: 'trace-a', prevTraceId: 'trace-a', createdAt: now, updatedAt: now },
  ]).run();
  connection.db.insert(supersedeLog).values({
    oldPath: 'psi/a.md', oldId: 'doc-a', oldTitle: 'A',
    newPath: 'psi/b.md', newId: 'doc-b', newTitle: 'B',
    reason: 'refresh', supersededAt: now + 1, supersededBy: 'test', project: 'demo',
  }).run();
}

function writeExportArtifact() {
  mkdirSync(exportDir, { recursive: true });
  const file = join(exportDir, 'oracle_documents-job-1.json');
  writeFileSync(file, '{"rows":[]}');
  utimesSync(file, lastExport, lastExport);
}

seed();
writeExportArtifact();
const app = new Elysia({ prefix: '/api' }).use(createExportStatsRoutes({ connection, exportDir }));
const fetcher = createApiVersionedFetch((request) => app.handle(request));
const mountedApp = new Elysia().use(exportAppRoutes);
const mountedFetcher = createApiVersionedFetch((request) => mountedApp.handle(request));

afterAll(() => {
  connection.storage.close();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(restoreDbPath());
  rmSync(root, { recursive: true, force: true });
});

describe('export stats HTTP route', () => {
  test('returns collection count, total docs, size, and last export time', async () => {
    const res = await fetcher(new Request('http://local/api/v1/export/stats'));
    const body = await res.json() as {
      collections: number;
      totalDocs: number;
      totalSize: string;
      lastExport: string;
    };

    expect(res.status).toBe(200);
    expect(body.collections).toBeGreaterThan(0);
    expect(body.totalDocs).toBeGreaterThanOrEqual(5);
    expect(body.totalSize).toMatch(/^\d+(\.\d)? (B|KB|MB|GB|TB)$/);
    expect(new Date(body.lastExport).toISOString()).toBe(lastExport.toISOString());
  });

  test('formats export byte sizes for dashboard display', () => {
    expect(formatExportSize(0)).toBe('0 B');
    expect(formatExportSize(1536)).toBe('1.5 KB');
  });

  test('mounts stats on the export app route cluster', async () => {
    const res = await mountedFetcher(new Request('http://local/api/v1/export/stats'));
    const body = await res.json() as { totalDocs: number };

    expect(res.status).toBe(200);
    expect(body.totalDocs).toBeGreaterThanOrEqual(5);
  });
});
