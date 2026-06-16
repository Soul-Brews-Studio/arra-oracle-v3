import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-http-'));
const dbPath = join(root, 'oracle.db');
const outputDir = join(root, 'http-export');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbModule = await import('../../../src/db/index.ts');
const { Elysia } = await import('elysia');
const { createApiVersionedFetch } = await import('../../../src/middleware/api-version.ts');
const { createExportAppRoutes } = await import('../../../src/routes/export/app.ts');

const { createDatabase, oracleDocuments, supersedeLog, traceLog, resetDefaultDatabaseForTests } = dbModule;
const connection = createDatabase(dbPath);

function restoreDbPath() {
  return savedDbPath ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
}

function seed() {
  const now = 1_766_000_000_000;
  connection.db.insert(oracleDocuments).values([
    {
      id: 'doc-old', type: 'learning', sourceFile: 'psi/learn/old.md', concepts: '["backup"]',
      createdAt: now, updatedAt: now, indexedAt: now, supersededBy: 'doc-new', supersededReason: 'refresh', createdBy: 'test',
    },
    {
      id: 'doc-new', type: 'learning', sourceFile: 'psi/learn/new.md', concepts: '["backup","safe"]',
      createdAt: now + 1, updatedAt: now + 1, indexedAt: now + 1, createdBy: 'test',
    },
  ]).run();
  connection.db.insert(traceLog).values([
    { traceId: 'trace-a', query: 'backup root', childTraceIds: '["trace-b"]', nextTraceId: 'trace-b', createdAt: now, updatedAt: now },
    { traceId: 'trace-b', query: 'backup child', parentTraceId: 'trace-a', prevTraceId: 'trace-a', createdAt: now, updatedAt: now },
  ]).run();
  connection.db.insert(supersedeLog).values({
    oldPath: 'psi/learn/old.md', oldId: 'doc-old', oldTitle: 'Old',
    newPath: 'psi/learn/new.md', newId: 'doc-new', newTitle: 'New',
    reason: 'refresh', supersededAt: now + 2, supersededBy: 'test', project: 'demo',
  }).run();
}

let job = 0;
seed();
const app = new Elysia({ prefix: '/api' }).use(createExportAppRoutes({
  connection,
  outputDir,
  idGenerator: () => `job-${++job}`,
  now: () => new Date('2026-01-02T03:04:05.006Z'),
}));
const fetcher = createApiVersionedFetch((request) => app.handle(request));

async function postRun(body: Record<string, unknown>) {
  return fetcher(new Request('http://local/api/v1/export/app/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

afterAll(() => {
  connection.storage.close();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(restoreDbPath());
  rmSync(root, { recursive: true, force: true });
});

describe('export app HTTP routes', () => {
  test('lists available collections and formats', async () => {
    const res = await fetcher(new Request('http://local/api/v1/export/app/collections'));
    const body = await res.json() as {
      collections: Array<{ name: string; rowCount: number }>;
      formats: string[];
      graph: { collection: string };
    };

    expect(res.status).toBe(200);
    expect(body.collections).toContainEqual(expect.objectContaining({ name: 'oracle_documents', rowCount: 2 }));
    expect(body.formats).toEqual(['json', 'csv', 'markdown']);
    expect(body.graph).toEqual({ collection: 'relationships' });
  });

  test('runs a JSON export with graph relationships and downloads it', async () => {
    const res = await postRun({ collection: 'oracle_documents', format: 'json', includeGraph: true });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      jobId: 'job-1',
      collection: 'oracle_documents',
      format: 'json',
      rowCount: 2,
      includeGraph: true,
      createdAt: '2026-01-02T03:04:05.006Z',
      downloadUrl: '/api/v1/export/app/download/job-1',
    });
    expect(body.relationshipCount).toBeGreaterThanOrEqual(4);
    expect('filePath' in body).toBe(false);
    expect(existsSync(join(outputDir, 'oracle_documents-job-1.json'))).toBe(true);

    const download = await fetcher(new Request(`http://local${body.downloadUrl}`));
    const payload = await download.json() as Record<string, any>;

    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('application/json');
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="oracle_documents-job-1.json"');
    expect(payload.rows.map((row: { id: string }) => row.id)).toEqual(['doc-old', 'doc-new']);
    expect(payload.graph.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'document_superseded_by', from: 'doc-old', to: 'doc-new' }),
      expect.objectContaining({ type: 'trace_next', from: 'trace-a', to: 'trace-b' }),
    ]));
  });

  test('runs a CSV export with the fixed tabular columns', async () => {
    const res = await postRun({ collection: 'oracle_documents', format: 'csv' });
    const body = await res.json() as { downloadUrl: string };
    const download = await fetcher(new Request(`http://local${body.downloadUrl}`));
    const csv = await download.text();

    expect(res.status).toBe(200);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('text/csv');
    expect(csv.split('\n')[0]).toBe('id,title,content_preview,collection,created_at');
    expect(csv).toContain('"doc-new"');
  });

  test('rejects unknown collections', async () => {
    const res = await postRun({ collection: 'missing_collection', format: 'json' });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe('Unknown export collection: missing_collection');
  });
});
