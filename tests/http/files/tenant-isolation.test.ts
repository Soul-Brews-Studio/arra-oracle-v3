import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, test } from 'bun:test';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-files-http-'));
const ghqRoot = path.join(tempRoot, 'ghq');
const repoA = path.join(ghqRoot, 'github.com/tenant-a/repo');
const repoB = path.join(ghqRoot, 'github.com/tenant-b/repo');
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantA = 'tenant-a';
const tenantB = 'tenant-b';
const ids = { a: `files-a-${stamp}`, b: `files-b-${stamp}` };

let db: any;
let sqlite: any;
let oracleDocuments: any;
let filesRouter: { handle: (request: Request) => Response | Promise<Response> };

beforeAll(async () => {
  fs.mkdirSync(repoA, { recursive: true });
  fs.mkdirSync(repoB, { recursive: true });
  fs.writeFileSync(path.join(repoB, 'secret.md'), 'tenant-b secret', 'utf-8');
  Bun.spawnSync(['git', 'init'], { cwd: repoA, stdout: 'pipe', stderr: 'pipe' });
  Bun.spawnSync(['git', 'init'], { cwd: repoB, stdout: 'pipe', stderr: 'pipe' });
  process.env.GHQ_ROOT = ghqRoot;
  process.env.ORACLE_REPO_ROOT = repoA;
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');

  const dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  db = dbModule.db;
  sqlite = dbModule.sqlite;
  oracleDocuments = dbModule.oracleDocuments;
  ({ filesRouter } = await import('../../../src/routes/files/index.ts'));
  insertDoc(ids.a, tenantA, 'learning', 'alpha tenant file body');
  insertDoc(ids.b, tenantB, 'principle', 'beta tenant file body');
});

function insertDoc(id: string, tenantId: string, type: string, content: string) {
  const now = Date.now();
  db.insert(oracleDocuments).values({
    id,
    tenantId,
    type,
    sourceFile: `github.com/${tenantId}/repo/ψ/docs/${id}.md`,
    concepts: JSON.stringify(['shared-files', tenantId]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: `github.com/${tenantId}/repo`,
    createdBy: 'files-tenant-test',
  }).run();
  sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, tenantId);
}

function request(tenantId: string, route: string, init: RequestInit = {}) {
  return createTenantFetch((req) => filesRouter.handle(req))(new Request(`http://local${route}`, {
    ...init,
    headers: { [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

describe('files routes tenant isolation', () => {
  test('GET /api/read hides document ids from other tenants', async () => {
    const denied = await request(tenantB, `/api/read?id=${ids.a}`);
    const allowed = await request(tenantA, `/api/read?id=${ids.a}`);
    const body = await allowed.json() as { content: string; source: string };

    expect(denied.status).toBe(404);
    expect(allowed.status).toBe(200);
    expect(body.source).toBe('fts_cache');
    expect(body.content).toContain('alpha tenant');
  });

  test('GET /api/graph includes only selected tenant document nodes', async () => {
    const res = await request(tenantB, '/api/graph?limit=10');
    const body = await res.json() as { nodes: Array<{ id: string }>; links: unknown[] };

    expect(res.status).toBe(200);
    expect(body.nodes.map((node) => node.id)).toContain(ids.b);
    expect(body.nodes.map((node) => node.id)).not.toContain(ids.a);
  });

  test('GET /api/file blocks cross-tenant project reads', async () => {
    const denied = await request(tenantA, '/api/file?project=github.com/tenant-b/repo&path=secret.md');
    const allowed = await request(tenantB, '/api/file?project=github.com/tenant-b/repo&path=secret.md');

    expect(denied.status).toBe(404);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe('tenant-b secret');
  });

  test('GET /api/context blocks cross-tenant project context', async () => {
    const cwd = encodeURIComponent(repoB);
    const denied = await request(tenantA, `/api/context?cwd=${cwd}`);
    const allowed = await request(tenantB, `/api/context?cwd=${cwd}`);
    const body = await allowed.json() as { ghqPath: string };

    expect(denied.status).toBe(404);
    expect(allowed.status).toBe(200);
    expect(body.ghqPath).toBe('github.com/tenant-b/repo');
  });

  test('POST /api/doc keeps cross-tenant id collisions generic', async () => {
    const res = await request(tenantA, '/api/doc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: ids.b,
        type: 'learning',
        content: 'tenant a duplicate id attempt',
      }),
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(409);
    expect(body.error).toBe('Document id unavailable');
  });
});
