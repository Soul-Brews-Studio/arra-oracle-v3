import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-core-'));
const dbPath = join(root, 'oracle.db');
const outputRoot = join(root, 'exports');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbModule = await import('../../../src/db/index.ts');
const { createExportCoreRoutes } = await import('../../../src/routes/export/core.ts');

const { createDatabase, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const connection = createDatabase(dbPath);

function seed() {
  const now = 1_766_000_000_000;
  connection.db.insert(oracleDocuments).values([
    {
      id: 'doc-alpha', type: 'learning', sourceFile: 'ψ/export/alpha.md',
      concepts: '["alpha","backup"]', createdAt: now, updatedAt: now + 1,
      indexedAt: now + 2, createdBy: 'test',
    },
    {
      id: 'doc-bravo', type: 'trace', sourceFile: 'ψ/export/bravo.md',
      concepts: '["bravo"]', createdAt: now + 3, updatedAt: now + 4,
      indexedAt: now + 5, createdBy: 'test',
    },
  ]).run();
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'doc-alpha',
    '# Alpha\n\nGround truth export body.',
    'alpha backup',
  );
  connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
    'doc-bravo',
    '# Bravo\n\nTrace export body.',
    'bravo',
  );
}

seed();

let job = 0;
const app = new Elysia({ prefix: '/api' }).use(createExportCoreRoutes({
  connection,
  outputDir: outputRoot,
  idGenerator: () => `job-${++job}`,
  now: () => new Date('2026-01-02T03:04:05.006Z'),
}));
const fetcher = createApiVersionedFetch((request) => app.handle(request));

function request(path: string, init?: RequestInit): Promise<Response> {
  return fetcher(new Request(`http://local${path}`, init));
}

afterAll(() => {
  connection.storage.close();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests(':memory:');
  rmSync(root, { recursive: true, force: true });
});

describe('export core HTTP routes', () => {
  test('GET /api/export/collections lists exportable collections', async () => {
    const res = await request('/api/v1/export/collections');
    const body = await res.json() as {
      collections: Array<{ name: string; rowCount: number; documentsUrl: string }>;
      formats: string[];
    };

    expect(res.status).toBe(200);
    expect(body.collections).toContainEqual(expect.objectContaining({
      name: 'oracle_documents',
      rowCount: 2,
      documentsUrl: '/api/v1/export/documents/oracle_documents',
    }));
    expect(body.formats).toEqual(['json', 'csv', 'markdown']);
  });

  test('GET /api/export/documents/:collection returns content-rich Oracle docs', async () => {
    const res = await request('/api/v1/export/documents/oracle_documents');
    const body = await res.json() as { count: number; documents: Array<Record<string, any>> };

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.documents[0]).toMatchObject({
      id: 'doc-alpha',
      source: 'ψ/export/alpha.md',
      content: expect.stringContaining('Ground truth export body.'),
      concepts: ['alpha', 'backup'],
    });
    expect(body.documents[0]?.metadata).toMatchObject({ type: 'learning', source_file: 'ψ/export/alpha.md' });
  });

  test('POST /api/export/run executes the standalone export engine', async () => {
    const res = await request('/api/v1/export/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, jobId: 'job-1', documentCount: 2 });
    const exportDir = join(outputRoot, 'job-1');
    expect(existsSync(join(exportDir, 'documents', 'markdown', 'export_alpha.md'))).toBe(true);
    expect(existsSync(join(exportDir, 'documents', 'json', 'export_alpha.json'))).toBe(true);
    expect(readFileSync(join(exportDir, 'documents', 'markdown', 'export_alpha.md'), 'utf8'))
      .toContain('Ground truth export body.');
  });

  test('GET /api/export/documents/:collection rejects unknown collections', async () => {
    const res = await request('/api/v1/export/documents/missing');
    const body = await res.json() as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toContain('Unknown export collection');
  });
});
