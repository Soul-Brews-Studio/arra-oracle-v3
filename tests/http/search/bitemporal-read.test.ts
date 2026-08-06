import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-bitemporal-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantId = `tenant-bitemporal-${stamp}`;
const oldDocId = `old-fact-${stamp}`;
const newDocId = `new-fact-${stamp}`;
const term = `bitemporalterm${stamp}`;
const oldValid = Date.parse('2024-01-01T00:00:00.000Z');
const newValid = Date.parse('2025-01-01T00:00:00.000Z');
const learnedLater = Date.parse('2026-01-01T00:00:00.000Z');

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

  dbModule.db.insert(dbModule.oracleDocuments).values([{
    id: oldDocId,
    tenantId,
    type: 'learning',
    sourceFile: 'ψ/shared/old-fact.md',
    concepts: JSON.stringify(['bitemporal']),
    createdAt: oldValid,
    updatedAt: oldValid,
    indexedAt: oldValid,
    validTime: oldValid,
    supersededBy: newDocId,
    supersededAt: learnedLater,
    supersededReason: 'later correction learned after the fact',
  }, {
    id: newDocId,
    tenantId,
    type: 'learning',
    sourceFile: 'ψ/shared/new-fact.md',
    concepts: JSON.stringify(['bitemporal']),
    createdAt: learnedLater,
    updatedAt: learnedLater,
    indexedAt: learnedLater,
    validTime: newValid,
  }]).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(oldDocId, `legacy fact with ${term}`, 'bitemporal');
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(newDocId, `corrected fact with ${term}`, 'bitemporal');
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

describe('bi-temporal search read', () => {
  test('GET /api/search?asOf uses valid_time separately from superseded_at transaction time', async () => {
    const beforeCorrection = await request(`/api/search?q=${term}&mode=fts&asOf=2024-06-01T00:00:00.000Z`);
    const beforeBody = await beforeCorrection.json() as { results: Array<Record<string, unknown>>; total: number };

    expect(beforeCorrection.status).toBe(200);
    expect(beforeBody.total).toBe(1);
    expect(beforeBody.results[0]).toMatchObject({
      id: oldDocId,
      valid_time: new Date(oldValid).toISOString(),
      valid_until: new Date(newValid).toISOString(),
      superseded_at: new Date(learnedLater).toISOString(),
    });

    const afterCorrection = await request(`/api/search?q=${term}&mode=fts&asOf=2025-06-01T00:00:00.000Z`);
    const afterBody = await afterCorrection.json() as { results: Array<Record<string, unknown>>; total: number };

    expect(afterCorrection.status).toBe(200);
    expect(afterBody.total).toBe(1);
    expect(afterBody.results[0]).toMatchObject({
      id: newDocId,
      valid_time: new Date(newValid).toISOString(),
      valid_until: null,
    });
  });


  test('GET /api/list?asOf applies the same valid-time support contract', async () => {
    const res = await request(`/api/list?group=false&asOf=2024-06-01T00:00:00.000Z`);
    const body = await res.json() as { results: Array<Record<string, unknown>>; total: number; asOfSupportedEndpoints: string[] };

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.results[0]).toMatchObject({
      id: oldDocId,
      valid_time: new Date(oldValid).toISOString(),
      valid_until: new Date(newValid).toISOString(),
    });
    expect(body.asOfSupportedEndpoints).toEqual([
      '/api/search', '/api/list', '/api/vector/search', '/api/ask',
      '/api/memory/fanout', '/api/memory/recall', '/api/memory/search',
    ]);
  });

  test('GET /api/search rejects invalid asOf timestamps', async () => {
    const res = await request(`/api/search?q=${term}&mode=fts&asOf=not-a-date`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid asOf timestamp' });
  });
});
