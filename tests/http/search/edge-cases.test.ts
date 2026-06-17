import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-edge-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantId = `tenant-edge-${stamp}`;
const docId = `search-edge-${stamp}`;
const conceptDocId = `search-concepts-${stamp}`;
const supersededDocId = `search-superseded-${stamp}`;
const successorDocId = `search-successor-${stamp}`;
const term = `edgeterm${stamp}`;
const conceptTerm = `conceptterm${stamp}`;
const supersedeTerm = `supersedeterm${stamp}`;
const supersededAt = Date.now() - 5000;

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

  const now = Date.now();
  dbModule.db.insert(dbModule.oracleDocuments).values({
    id: docId,
    tenantId,
    type: 'learning',
    sourceFile: 'ψ/shared/search-edge.md',
    concepts: JSON.stringify(['edge']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'edge',
    createdBy: 'search-edge-test',
  }).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(docId, `document with ${term}`, 'edge');
  dbModule.db.insert(dbModule.oracleDocuments).values({
    id: conceptDocId,
    tenantId,
    type: 'learning',
    sourceFile: 'ψ/shared/search-concepts.md',
    concepts: '"not-array"',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'edge',
    createdBy: 'search-edge-test',
  }).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(conceptDocId, `document with ${conceptTerm}`, 'edge');
  dbModule.db.insert(dbModule.oracleDocuments).values([{
    id: supersededDocId,
    tenantId,
    type: 'learning',
    sourceFile: 'ψ/shared/search-superseded.md',
    concepts: JSON.stringify(['supersede']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'edge',
    createdBy: 'search-edge-test',
    supersededBy: successorDocId,
    supersededAt,
    supersededReason: 'newer source of truth',
  }, {
    id: successorDocId,
    tenantId,
    type: 'learning',
    sourceFile: 'ψ/shared/search-successor.md',
    concepts: JSON.stringify(['supersede']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'edge',
    createdBy: 'search-edge-test',
  }]).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(supersededDocId, `legacy memory with ${supersedeTerm}`, 'supersede');
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(successorDocId, 'replacement memory without old token', 'supersede');
});

function request(route: string) {
  return createTenantFetch((req) => searchRoutes.handle(req))(new Request(`http://local${route}`, {
    headers: { [tenantHeader]: tenantId },
  }));
}

afterAll(() => {
  dbModule?.closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('search route edge cases', () => {
  test('GET /api/search rejects unknown search modes before hitting handlers', async () => {
    const res = await request(`/api/search?q=${term}&mode=nearest`);
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid search mode');
  });

  test('GET /api/search quotes tenant FTS tokens that look like operators', async () => {
    const q = encodeURIComponent(`${term} OR (`);
    const res = await request(`/api/search?q=${q}&mode=fts`);
    const body = await res.json() as { results: Array<{ id: string }>; total: number; error?: string };

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.total).toBe(1);
    expect(body.results.map((item) => item.id)).toEqual([docId]);
  });

  test('GET /api/search normalizes mode and malformed concepts', async () => {
    const res = await request(`/api/search?q=${conceptTerm}&mode=%20FTS%20&limit=2abc`);
    const body = await res.json() as { results: Array<{ id: string; concepts: string[] }>; limit: number; total: number };

    expect(res.status).toBe(200);
    expect(body.limit).toBe(10);
    expect(body.total).toBe(1);
    expect(body.results).toEqual([expect.objectContaining({ id: conceptDocId, concepts: [] })]);
  });

  test('GET /api/search surfaces supersede status inline with results', async () => {
    const res = await request(`/api/search?q=${supersedeTerm}&mode=fts`);
    const body = await res.json() as { results: Array<Record<string, unknown>>; total: number };

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: supersededDocId,
      superseded_by: successorDocId,
      superseded_at: new Date(supersededAt).toISOString(),
      superseded_reason: 'newer source of truth',
    });
  });

  test('GET /api/list falls back on safe pagination for bad numbers', async () => {
    const res = await request('/api/list?limit=2abc&offset=-10');
    const body = await res.json() as { results: Array<{ id: string }>; limit: number; offset: number; total: number };

    expect(res.status).toBe(200);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.total).toBe(4);
    expect(body.results.map((item) => item.id)).toEqual(expect.arrayContaining([docId, conceptDocId]));
  });
});
