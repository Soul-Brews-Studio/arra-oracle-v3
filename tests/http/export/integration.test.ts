import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const root = join(tmpdir(), `arra-export-http-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_REPO_ROOT = root;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createLearnCrudRoutes } = await import('../../../src/routes/learn/index.ts');
const { createExportAppRoutes } = await import('../../../src/routes/export/app.ts');
const { exportRoutes } = await import('../../../src/routes/export/index.ts');

const restoreDbPath = savedDbPath
  ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');

const app = new Elysia({ prefix: '/api' })
  .use(createLearnCrudRoutes())
  .use(createExportAppRoutes());

function request(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return createApiVersionedFetch((next) => app.handle(next))(new Request(`http://local${path}`, init));
}

async function createLearning(id: string, pattern: string): Promise<void> {
  const res = await request('POST', '/api/v1/learn', {
    id,
    pattern,
    concepts: ['export', id],
    source: 'export-integration-test',
    sourceFile: `psi/export/${id}.md`,
  });
  expect(res.status).toBe(200);
}

async function seedLearnings(): Promise<void> {
  await createLearning('export-doc-alpha', 'Alpha export integration body');
  await createLearning('export-doc-bravo', 'Bravo export integration body');
}

interface ExportJobResponse {
  downloadUrl: string;
  filename: string;
  rowCount: number;
  relationshipCount: number;
}

async function downloadExport(
  collection: string,
  format: string,
  extra: Record<string, unknown> = {},
): Promise<{ run: Response; job: ExportJobResponse; download: Response }> {
  const run = await request('POST', '/api/v1/export/app/run', { collection, format, ...extra });
  const job = await run.json() as ExportJobResponse;
  const download = await request('GET', job.downloadUrl);
  return { run, job, download };
}

function exportCollection(format: string, extra: Record<string, unknown> = {}) {
  return downloadExport('learn_log', format, extra);
}

beforeEach(() => {
  dbMod.db.delete(dbMod.exportJobs).run();
  dbMod.db.delete(dbMod.learnLog).run();
  dbMod.db.delete(dbMod.oracleDocuments).run();
  dbMod.db.delete(dbMod.oracleMemories).run();
  dbMod.sqlite.exec('DELETE FROM oracle_fts');
});

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  if (savedRepoRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = savedRepoRoot;
  dbMod.resetDefaultDatabaseForTests(restoreDbPath);
  rmSync(root, { recursive: true, force: true });
});

describe('POST /api/v1/export/app/run', () => {
  test('exports API-created docs as JSON, CSV, Markdown, and JSONL downloads', async () => {
    await seedLearnings();

    const jsonExport = await exportCollection('json');
    const json = await jsonExport.download.json() as { collection: string; rowCount: number; rows: Array<Record<string, unknown>> };
    expect(jsonExport.run.status).toBe(200);
    expect(jsonExport.download.headers.get('content-disposition')).toContain(jsonExport.job.filename);
    expect(jsonExport.job.rowCount).toBe(2);
    expect(json.collection).toBe('learn_log');
    expect(json.rowCount).toBe(2);
    expect(json.rows.map((row) => row.patternPreview)).toEqual(expect.arrayContaining([
      'Alpha export integration body',
      'Bravo export integration body',
    ]));

    const csvExport = await exportCollection('csv');
    const csv = await csvExport.download.text();
    expect(csvExport.download.status).toBe(200);
    expect(csv.split('\n')[0]).toBe('id,title,content_preview,collection,created_at');
    expect(csv).toContain('"Alpha export integration body"');
    expect(csv).toContain('"Bravo export integration body"');

    const markdown = await (await exportCollection('markdown')).download.text();
    expect(markdown).toContain('# learn_log');
    expect(markdown).toContain('Alpha export integration body');
    expect(markdown).toContain('Bravo export integration body');

    const jsonlExport = await exportCollection('jsonl');
    const jsonl = await jsonlExport.download.text();
    expect(jsonlExport.job.filename.endsWith('.jsonl')).toBe(true);
    const lines = jsonl.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines.map((row) => row.patternPreview)).toContain('Alpha export integration body');
  });

  test('includes graph relationships when requested', async () => {
    await seedLearnings();
    const update = await request('PUT', '/api/v1/learn/export-doc-alpha', {
      supersededBy: 'export-doc-bravo',
      supersededReason: 'integration graph edge',
    });
    expect(update.status).toBe(200);

    const { run, job, download } = await downloadExport('oracle_documents', 'json', { includeGraph: true });
    const body = await download.json() as { graph: { relationships: Array<Record<string, unknown>> } };
    expect(run.status).toBe(200);
    expect(job.relationshipCount).toBeGreaterThanOrEqual(1);
    expect(body.graph.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'document_superseded_by',
        from: 'export-doc-alpha',
        to: 'export-doc-bravo',
      }),
    ]));
  });

  test('returns errors for empty collection and invalid format', async () => {
    const empty = await request('POST', '/api/v1/export/app/run', {
      collection: 'oracle_memories',
      format: 'json',
    });
    expect(empty.status).toBe(404);
    expect(await empty.json()).toMatchObject({ error: 'Collection is empty', collection: 'oracle_memories' });

    const invalid = await request('POST', '/api/v1/export/app/run', {
      collection: 'learn_log',
      format: 'yaml',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'Invalid format' });
  });
});

describe('POST /api/export/run Oracle v2 integration', () => {
  test('spawns server, pulls a mock Oracle v2 collection, and writes an export file', async () => {
    const seen: string[] = [];
    const legacy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        seen.push(`${url.pathname}${url.search}`);
        if (url.pathname === '/api/collections') {
          return Response.json({ collections: [{ name: 'oracle_documents', count: 2 }] });
        }
        if (url.pathname === '/api/documents' && url.searchParams.get('collection') === 'oracle_documents') {
          return Response.json({ documents: [
            { id: 'legacy-a', content: 'Alpha legacy body', metadata: { source_file: 'psi/a.md' } },
            { id: 'legacy-b', content: 'Bravo legacy body', metadata: { source_file: 'psi/b.md' } },
          ] });
        }
        return Response.json({ error: 'not found' }, { status: 404 });
      },
    });
    const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: new Elysia().use(exportRoutes).fetch });

    try {
      const res = await fetch(`http://127.0.0.1:${api.port}/api/export/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          collection: 'oracle_documents',
          format: 'json',
          oracleV2Url: `http://127.0.0.1:${legacy.port}`,
        }),
      });
      const body = await res.json() as Record<string, any>;

      expect(res.status).toBe(201);
      expect(body.job).toMatchObject({ collection: 'oracle_documents', format: 'json', status: 'completed' });
      expect(body.artifact).toMatchObject({ filename: expect.stringContaining('oracle_documents'), documentCount: 2 });
      expect(existsSync(body.artifact.filePath)).toBe(true);
      const file = JSON.parse(readFileSync(body.artifact.filePath, 'utf8'));
      expect(file).toMatchObject({ source: 'oracle-v2', collection: 'oracle_documents', documentCount: 2 });
      expect(file.documents.map((doc: { id: string }) => doc.id)).toEqual(['legacy-a', 'legacy-b']);
      expect(seen).toEqual(['/api/collections', '/api/documents?collection=oracle_documents']);
    } finally {
      api.stop(true);
      legacy.stop(true);
    }
  });
});
