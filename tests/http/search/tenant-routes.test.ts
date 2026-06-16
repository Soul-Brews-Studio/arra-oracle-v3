import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, test } from 'bun:test';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-http-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const ids = { a: `search-a-${stamp}`, b: `search-b-${stamp}` };
const sharedTerm = `sharedterm${stamp}`;

let db: any;
let sqlite: any;
let oracleDocuments: any;
let searchRoutes: { handle: (request: Request) => Response | Promise<Response> };

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  const dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  db = dbModule.db;
  sqlite = dbModule.sqlite;
  oracleDocuments = dbModule.oracleDocuments;
  ({ searchRoutes } = await import('../../../src/routes/search/index.ts'));
  insertDoc(ids.a, tenantA, 'learning', `alpha-only ${sharedTerm}`);
  insertDoc(ids.b, tenantB, 'principle', `beta-only ${sharedTerm}`);
});

function insertDoc(id: string, tenantId: string, type: string, content: string) {
  const now = Date.now();
  db.insert(oracleDocuments).values({
    id,
    tenantId,
    type,
    sourceFile: 'ψ/shared/tenant-search.md',
    concepts: JSON.stringify([tenantId]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: tenantId,
    createdBy: 'tenant-search-test',
  }).run();
  sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, tenantId);
}

function request(tenantId: string, route: string) {
  return createTenantFetch((req) => searchRoutes.handle(req))(new Request(`http://local${route}`, {
    headers: { [TENANT_HEADER]: tenantId },
  }));
}

describe('search routes tenant isolation', () => {
  test('GET /api/search hides matching documents from other tenants', async () => {
    const res = await request(tenantA, `/api/search?q=${sharedTerm}&mode=fts`);
    const body = await res.json() as { results: Array<{ id: string }>; total: number };

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.results.map((item) => item.id)).toEqual([ids.a]);
  });

  test('GET /api/list groups and counts only selected tenant documents', async () => {
    const res = await request(tenantB, '/api/list?group=true&limit=10');
    const body = await res.json() as { results: Array<{ id: string }>; total: number };

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.results.map((item) => item.id)).toEqual([ids.b]);
  });

  test('GET /api/reflect samples only selected tenant documents', async () => {
    const res = await request(tenantB, '/api/reflect');
    const body = await res.json() as { id: string; content: string };

    expect(res.status).toBe(200);
    expect(body.id).toBe(ids.b);
    expect(body.content).toContain('beta-only');
  });
});
