import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Elysia } from 'elysia';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const savedGhqRoot = process.env.GHQ_ROOT;
const root = mkdtempSync(path.join(tmpdir(), 'arra-read-http-'));
const repoRoot = path.join(root, 'repo');
const dataDir = path.join(root, 'data');
const dbPath = path.join(dataDir, 'oracle.db');
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.GHQ_ROOT = path.join(root, 'ghq');
mkdirSync(repoRoot, { recursive: true });
mkdirSync(dataDir, { recursive: true });

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { readRoute } = await import('../../../src/routes/files/read.ts');
const { listEndpoint } = await import('../../../src/routes/search/list.ts');

const app = new Elysia()
  .use(readRoute)
  .use(new Elysia({ prefix: '/api' }).use(listEndpoint));

beforeEach(() => {
  dbMod.sqlite.prepare('DELETE FROM oracle_fts').run();
  dbMod.db.delete(dbMod.oracleDocuments).run();
  rmSync(path.join(repoRoot, 'ψ'), { recursive: true, force: true });
});

afterAll(() => {
  dbMod.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  if (savedRepoRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = savedRepoRoot;
  if (savedGhqRoot === undefined) delete process.env.GHQ_ROOT;
  else process.env.GHQ_ROOT = savedGhqRoot;
  rmSync(root, { recursive: true, force: true });
});

function request(tenantId: string, route: string) {
  return createTenantFetch((req) => app.handle(req))(new Request(`http://local${route}`, {
    headers: { [TENANT_HEADER]: tenantId },
  }));
}

function withQuery(pathname: string, query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return `${pathname}?${params.toString()}`;
}

function writeRepoFile(sourceFile: string, content: string) {
  const filePath = path.join(repoRoot, sourceFile);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function seedDoc(opts: {
  id: string;
  tenantId: string;
  sourceFile: string;
  content: string;
  indexedAt: number;
  type?: string;
}) {
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id: opts.id,
    tenantId: opts.tenantId,
    type: opts.type ?? 'learning',
    sourceFile: opts.sourceFile,
    concepts: JSON.stringify(['read']),
    createdAt: opts.indexedAt,
    updatedAt: opts.indexedAt,
    indexedAt: opts.indexedAt,
  }).run();
  dbMod.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(opts.id, opts.content, 'read');
}

describe('read and list route hardening', () => {
  test('GET /api/read reads tenant files by path and document id', async () => {
    const sourceFile = 'ψ/tenants/tenant-a/memory/read-me.md';
    seedDoc({ id: 'read-a', tenantId: 'tenant-a', sourceFile, content: 'cached A', indexedAt: 10 });
    writeRepoFile(sourceFile, '# Tenant A\nfile body');

    const byPath = await request('tenant-a', withQuery('/api/read', { file: sourceFile }));
    const byPathBody = await byPath.json() as { content: string; source: string };
    const byId = await request('tenant-a', withQuery('/api/read', { id: 'read-a' }));
    const byIdBody = await byId.json() as { content: string; source_file: string; source: string };

    expect(byPath.status).toBe(200);
    expect(byPathBody).toMatchObject({ content: '# Tenant A\nfile body', source: 'file' });
    expect(byId.status).toBe(200);
    expect(byIdBody).toMatchObject({ source_file: sourceFile, source: 'file' });
  });

  test('GET /api/read returns explicit errors for missing params and not-found targets', async () => {
    const noParams = await request('tenant-a', '/api/read');
    const missingId = await request('tenant-a', withQuery('/api/read', { id: 'missing-doc' }));
    const missingFile = await request('tenant-a', withQuery('/api/read', { file: 'ψ/missing.md' }));

    expect(noParams.status).toBe(400);
    expect(await noParams.json()).toEqual({ error: 'Provide file or id parameter' });
    expect(missingId.status).toBe(404);
    expect(await missingId.json()).toEqual({ error: 'Document not found: missing-doc' });
    expect(missingFile.status).toBe(404);
    expect((await missingFile.json() as { source_file: string }).source_file).toBe('ψ/missing.md');
  });

  test('GET /api/list paginates within the active tenant only', async () => {
    for (let i = 1; i <= 3; i += 1) {
      seedDoc({
        id: `tenant-a-${i}`,
        tenantId: 'tenant-a',
        sourceFile: `ψ/tenants/tenant-a/memory/${i}.md`,
        content: `tenant A ${i}`,
        indexedAt: i,
      });
    }
    seedDoc({
      id: 'tenant-b-private',
      tenantId: 'tenant-b',
      sourceFile: 'ψ/tenants/tenant-b/memory/private.md',
      content: 'tenant B secret',
      indexedAt: 99,
    });

    const res = await request('tenant-a', '/api/list?group=false&limit=2&offset=1');
    const body = await res.json() as { results: Array<{ id: string }>; total: number; limit: number; offset: number };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(body.results.map((item) => item.id)).toEqual(['tenant-a-2', 'tenant-a-1']);
    expect(body.results.some((item) => item.id === 'tenant-b-private')).toBe(false);
  });

  test('tenant read requests cannot access another tenant by id or explicit tenant path', async () => {
    const sourceFile = 'ψ/tenants/tenant-b/memory/private.md';
    seedDoc({ id: 'tenant-b-private', tenantId: 'tenant-b', sourceFile, content: 'tenant B cache', indexedAt: 1 });
    writeRepoFile(sourceFile, 'tenant B file secret');

    const hiddenById = await request('tenant-a', withQuery('/api/read', { id: 'tenant-b-private' }));
    const hiddenByPath = await request('tenant-a', withQuery('/api/read', { file: sourceFile }));
    const visible = await request('tenant-b', withQuery('/api/read', { file: sourceFile }));

    expect(hiddenById.status).toBe(404);
    expect(hiddenByPath.status).toBe(404);
    expect(JSON.stringify(await hiddenByPath.json())).not.toContain('tenant B file secret');
    expect(visible.status).toBe(200);
    expect((await visible.json() as { content: string }).content).toBe('tenant B file secret');
  });
});
