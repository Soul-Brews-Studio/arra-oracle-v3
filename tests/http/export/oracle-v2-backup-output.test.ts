import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'arra-export-v2-output-'));
const dbPath = join(root, 'oracle.db');

process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { Elysia } = await import('elysia');
const { createApiVersionedFetch } = await import('../../../src/middleware/api-version.ts');
const { exportRoutes } = await import('../../../src/routes/export/index.ts');

type Artifact = {
  contentType: string;
  documentCount: number;
  downloadUrl: string;
  filename: string;
  filePath: string;
  sizeBytes: number;
};

type RunResponse = {
  artifact?: Artifact;
  collections?: string[];
  error?: string;
  job?: { collection: string; format: string; status: string };
};

type ServerUrls = { apiUrl: string; legacyUrl: string };
type LegacyHandler = (url: URL) => Response | Promise<Response>;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function withServers(handler: LegacyHandler, run: (urls: ServerUrls) => Promise<void>) {
  const legacy = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (req) => handler(new URL(req.url)),
  });
  const app = new Elysia().use(exportRoutes);
  const fetcher = createApiVersionedFetch((request) => app.handle(request));
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: fetcher });
  try {
    await run({
      apiUrl: `http://127.0.0.1:${api.port}`,
      legacyUrl: `http://127.0.0.1:${legacy.port}`,
    });
  } finally {
    api.stop(true);
    legacy.stop(true);
  }
}

async function runOracleV2Export(apiUrl: string, body: Record<string, unknown>) {
  const res = await fetch(`${apiUrl}/api/export/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json() as RunResponse };
}

function artifactFrom(body: RunResponse): Artifact {
  if (!body.artifact) throw new Error(`missing artifact: ${JSON.stringify(body)}`);
  return body.artifact;
}

beforeEach(() => {
  dbMod.db.delete(dbMod.exportJobs).run();
});

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  dbMod.resetDefaultDatabaseForTests(':memory:');
  rmSync(root, { recursive: true });
});

describe('Oracle v2 backup output hardening', () => {
  test('writes an empty collection backup as a downloadable JSON artifact', async () => {
    await withServers((url) => {
      if (url.pathname === '/api/collections') return json({ collections: [{ name: 'empty_docs', count: 0 }] });
      if (url.pathname === '/api/documents' && url.searchParams.get('collection') === 'empty_docs') {
        return json({ documents: [] });
      }
      return json({ error: 'not found' }, 404);
    }, async ({ apiUrl, legacyUrl }) => {
      const { res, body } = await runOracleV2Export(apiUrl, {
        collection: 'empty_docs',
        format: 'json',
        oracleV2Url: legacyUrl,
      });
      const artifact = artifactFrom(body);
      const file = JSON.parse(readFileSync(artifact.filePath, 'utf8')) as Record<string, unknown>;
      const download = await fetch(`${apiUrl}${artifact.downloadUrl}`);

      expect(res.status).toBe(201);
      expect(existsSync(artifact.filePath)).toBe(true);
      expect(artifact).toMatchObject({ documentCount: 0, contentType: 'application/json; charset=utf-8' });
      expect(file).toMatchObject({ source: 'oracle-v2', collection: 'empty_docs', documentCount: 0, documents: [] });
      expect(download.status).toBe(200);
      expect(await download.json()).toMatchObject({ collection: 'empty_docs', documentCount: 0, documents: [] });
    });
  });

  test('does not truncate large Oracle v2 JSON backups', async () => {
    const docs = Array.from({ length: 1200 }, (_, index) => ({
      id: `doc-${String(index + 1).padStart(4, '0')}`,
      title: `Large backup document ${index + 1}`,
      content: `Large export body ${index + 1} `.repeat(4).trim(),
      metadata: { source_file: `psi/large/${index + 1}.md`, ordinal: index + 1 },
    }));

    await withServers((url) => {
      if (url.pathname === '/api/collections') return json({ collections: [{ name: 'large_docs', count: docs.length }] });
      if (url.pathname === '/api/documents' && url.searchParams.get('collection') === 'large_docs') {
        return json({ documents: docs });
      }
      return json({ error: 'not found' }, 404);
    }, async ({ apiUrl, legacyUrl }) => {
      const { res, body } = await runOracleV2Export(apiUrl, {
        collection: 'large_docs',
        format: 'json',
        oracleV2Url: legacyUrl,
      });
      const artifact = artifactFrom(body);
      const file = JSON.parse(readFileSync(artifact.filePath, 'utf8')) as { documents: typeof docs; documentCount: number };

      expect(res.status).toBe(201);
      expect(artifact.documentCount).toBe(docs.length);
      expect(artifact.sizeBytes).toBeGreaterThan(docs.length * 120);
      expect(file.documentCount).toBe(docs.length);
      expect(file.documents).toHaveLength(docs.length);
      expect(file.documents[0]).toMatchObject({ id: 'doc-0001' });
      expect(file.documents.at(-1)).toMatchObject({ id: 'doc-1200' });
    });
  });

  test('rejects malformed Oracle v2 document payloads without writing an artifact', async () => {
    await withServers((url) => {
      if (url.pathname === '/api/collections') return json({ collections: [{ name: 'malformed_docs', count: 1 }] });
      if (url.pathname === '/api/documents' && url.searchParams.get('collection') === 'malformed_docs') {
        return json({ documents: [{ id: 'ok', content: 'valid' }, null] });
      }
      return json({ error: 'not found' }, 404);
    }, async ({ apiUrl, legacyUrl }) => {
      const { res, body } = await runOracleV2Export(apiUrl, {
        collection: 'malformed_docs',
        format: 'json',
        oracleV2Url: legacyUrl,
      });

      expect(res.status).toBe(502);
      expect(body.error).toContain('documents[1] must be an object');
      expect(body.artifact).toBeUndefined();
      expect(body.job).toMatchObject({ collection: 'malformed_docs', format: 'json' });
    });
  });
});
