import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-v2-md-'));
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = join(root, 'oracle.db');

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { exportRoutes } = await import('../../../src/routes/export/index.ts');

function legacyOracle() {
  const seen: string[] = [];
  const server = Bun.serve({
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
          {
            id: 'legacy-a',
            title: 'Alpha note',
            content: '# Alpha\n\nAlpha legacy body',
            metadata: { source_file: 'psi/a.md', concepts: ['alpha', 'backup'] },
          },
          { id: 'legacy-b', document: 'Bravo legacy body', source_file: 'psi/b.md', concepts: 'bravo migrate' },
        ] });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    },
  });
  return { server, seen };
}

async function postExport(body: Record<string, unknown>): Promise<Response> {
  const api = new Elysia().use(exportRoutes);
  return api.handle(new Request('http://local/api/export/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function getExport(path: string): Promise<Response> {
  const api = new Elysia().use(exportRoutes);
  return api.handle(new Request(`http://local${path}`));
}

afterAll(() => {
  dbMod.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  dbMod.resetDefaultDatabaseForTests(':memory:');
  rmSync(root, { recursive: true, force: true });
});

describe('Oracle v2 markdown export history route', () => {
  test('lists collections from a legacy Oracle v2 backend', async () => {
    const legacy = legacyOracle();
    try {
      const query = new URLSearchParams({ baseUrl: `http://127.0.0.1:${legacy.server.port}` });
      const res = await getExport(`/api/export/oracle-v2/collections?${query.toString()}`);
      const body = await res.json() as Record<string, any>;

      expect(res.status).toBe(200);
      expect(body.collections).toEqual([{ name: 'oracle_documents', count: 2 }]);
      expect(body.total).toBe(1);
      expect(legacy.seen).toEqual(['/api/collections']);
    } finally {
      legacy.server.stop(true);
    }
  });

  test('writes a Markdown artifact for Oracle v2 documents', async () => {
    const legacy = legacyOracle();
    try {
      const res = await postExport({
        collection: 'oracle_documents',
        format: 'markdown',
        oracleV2Url: `http://127.0.0.1:${legacy.server.port}`,
      });
      const body = await res.json() as Record<string, any>;
      const artifact = body.artifact as { filename: string; filePath: string; downloadUrl: string };
      const filename = artifact.filename;
      const filePath = artifact.filePath;
      const downloadUrl = artifact.downloadUrl;

      expect(res.status).toBe(201);
      expect(body.job).toMatchObject({ collection: 'oracle_documents', format: 'markdown' });
      expect(body.artifact).toMatchObject({
        filename: expect.stringContaining('oracle_documents'),
        contentType: 'text/markdown; charset=utf-8',
        documentCount: 2,
        downloadUrl: expect.stringContaining('/api/v1/export/history/'),
      });
      expect(filename.endsWith('.md')).toBe(true);
      expect(existsSync(filePath)).toBe(true);

      const markdown = readFileSync(filePath, 'utf8');
      expect(markdown).toContain('# Oracle v2 export: oracle_documents');
      expect(markdown).toContain('source_file: "psi/a.md"');
      expect(markdown).toContain('- "alpha"');
      expect(markdown).toContain('Alpha legacy body');
      expect(markdown).toContain('Bravo legacy body');
      expect(legacy.seen).toEqual(['/api/collections', '/api/documents?collection=oracle_documents']);

      const download = await getExport(downloadUrl.replace('/api/v1', '/api'));
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(await download.text()).toBe(markdown);
    } finally {
      legacy.server.stop(true);
    }
  });

  test('writes a CSV artifact for Oracle v2 documents', async () => {
    const legacy = legacyOracle();
    try {
      const res = await postExport({
        collection: 'oracle_documents',
        format: 'csv',
        oracleV2Url: `http://127.0.0.1:${legacy.server.port}`,
      });
      const body = await res.json() as Record<string, any>;
      const artifact = body.artifact as { filename: string; filePath: string };
      const filename = artifact.filename;
      const filePath = artifact.filePath;

      expect(res.status).toBe(201);
      expect(body.job).toMatchObject({ collection: 'oracle_documents', format: 'csv' });
      expect(body.artifact).toMatchObject({
        filename: expect.stringContaining('oracle_documents'),
        contentType: 'text/csv; charset=utf-8',
        documentCount: 2,
      });
      expect(filename.endsWith('.csv')).toBe(true);
      const csv = readFileSync(filePath, 'utf8');
      expect(csv.split('\n')[0]).toBe('id,title,source_file,concepts,content_preview,metadata_json');
      expect(csv).toContain('"legacy-a","Alpha note","psi/a.md","alpha backup"');
      expect(csv).toContain('Alpha legacy body');
    } finally {
      legacy.server.stop(true);
    }
  });

  test('keeps unsupported Oracle v2 formats rejected', async () => {
    const res = await postExport({
      collection: 'oracle_documents',
      format: 'xml',
      oracleV2Url: 'http://127.0.0.1:1',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Oracle v2 export supports json, markdown, or csv format only',
      format: 'xml',
    });
  });
});
