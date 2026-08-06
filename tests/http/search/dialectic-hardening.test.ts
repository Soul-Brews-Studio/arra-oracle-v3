import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-dialectic-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-search-a-${stamp}`;
const tenantB = `tenant-search-b-${stamp}`;
const docA = `search-a-${stamp}`;
const docB = `search-b-${stamp}`;
const term = `dialecticsearch${stamp}`;

let dbModule: typeof import('../../../src/db/index.ts');
let searchRoutes: { handle: (request: Request) => Response | Promise<Response> };
let createTenantFetch: typeof import('../../../src/middleware/tenant.ts').createTenantFetch;
let tenantHeader: string;

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  const tenant = await import('../../../src/middleware/tenant.ts');
  createTenantFetch = tenant.createTenantFetch;
  tenantHeader = tenant.TENANT_HEADER;
  ({ searchRoutes } = await import('../../../src/routes/search/index.ts'));
  insertDoc(docA, tenantA, `alpha dialectic evidence ${term}`);
  insertDoc(docB, tenantB, `beta dialectic evidence ${term}`);
});

function insertDoc(id: string, tenantId: string, content: string) {
  const now = Date.now();
  dbModule.db.insert(dbModule.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/shared/${id}.md`,
    concepts: JSON.stringify(['dialectic', tenantId]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'dialectic',
    createdBy: 'dialectic-search-test',
  }).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, 'dialectic');
}

function request(route: string, tenantId = tenantA) {
  return createTenantFetch((req) => searchRoutes.handle(req))(new Request(`http://local${route}`, {
    headers: { [tenantHeader]: tenantId },
  }));
}

afterAll(() => {
  dbModule?.closeDb();
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('search Dialectic hardening', () => {
  test('rejects queries that sanitize to empty text', async () => {
    const res = await request('/api/search?q=%3Cb%3E%3C%2Fb%3E&mode=fts');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid query: empty after sanitization' });
  });

  test('rejects unsupported Dialectic modes before retrieval', async () => {
    const res = await request(`/api/search?q=${term}&mode=dialectic`);
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid search mode');
  });

  test('rejects missing embedding model keys instead of falling back silently', async () => {
    const res = await request(`/api/search?q=${term}&mode=hybrid&model=missing-model-${stamp}`);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `Unknown model: missing-model-${stamp}` });
  });

  test('tenant-scoped search returns only the active tenant evidence', async () => {
    const res = await request(`/api/search?q=${term}&mode=fts`, tenantB);
    const body = await res.json() as { results: Array<{ id: string }>; total: number };

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.results.map((item) => item.id)).toEqual([docB]);
  });
});
