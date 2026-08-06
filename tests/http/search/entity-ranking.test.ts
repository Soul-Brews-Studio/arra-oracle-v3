import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-entity-ranking-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantId = `tenant-entity-${stamp}`;
const term = `entityrank${stamp}`;
const ids = {
  plain: `entity-plain-${stamp}`,
  linked: `entity-linked-${stamp}`,
  hidden: `entity-hidden-${stamp}`,
};

let dbModule: typeof import('../../../src/db/index.ts');
let searchRoutes: { handle: (request: Request) => Response | Promise<Response> };
let createTenantFetch: typeof import('../../../src/middleware/tenant.ts').createTenantFetch;
let tenantHeader: string;
let replaceEntityLinks: typeof import('../../../src/search/entity-ranking.ts').replaceEntityLinks;

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  const tenant = await import('../../../src/middleware/tenant.ts');
  createTenantFetch = tenant.createTenantFetch;
  tenantHeader = tenant.TENANT_HEADER;
  ({ searchRoutes } = await import('../../../src/routes/search/index.ts'));
  ({ replaceEntityLinks } = await import('../../../src/search/entity-ranking.ts'));

  insertDoc(ids.plain, `neutral memory with ${term}`);
  insertDoc(ids.linked, `neutral memory with ${term}`);
  insertDoc(ids.hidden, 'not a keyword candidate');
  replaceEntityLinks(dbModule.sqlite, {
    documentId: ids.linked,
    tenantId,
    content: 'Alpha Project sidecar mention only',
    concepts: [],
  });
  replaceEntityLinks(dbModule.sqlite, {
    documentId: ids.hidden,
    tenantId,
    content: 'Alpha Project entity without keyword match',
    concepts: [],
  });
});

function insertDoc(id: string, content: string) {
  const now = Date.now();
  dbModule.db.insert(dbModule.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/shared/${id}.md`,
    concepts: JSON.stringify([]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'entity-ranking',
    createdBy: 'entity-ranking-test',
  }).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, '');
}

function request(route: string) {
  return createTenantFetch((req) => searchRoutes.handle(req))(new Request(`http://local${route}`, {
    headers: { [tenantHeader]: tenantId },
  }));
}

afterAll(() => {
  dbModule?.closeDb();
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true });
});

describe('entity-link sidecar ranking signal', () => {
  test('boosts candidate results with matching entity links without adding entity-only hits', async () => {
    const query = encodeURIComponent(`Alpha Project ${term}`);
    const res = await request(`/api/search?q=${query}&mode=fts&limit=10`);
    const body = await res.json() as {
      results: Array<{ id: string; score: number; entity_score?: number; entity_matches?: string[] }>;
      total: number;
    };

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.results.map((item) => item.id)).toEqual([ids.linked, ids.plain]);
    expect(body.results[0].entity_score).toBeGreaterThan(0);
    expect(body.results[0].entity_matches).toContain('Alpha Project');
    expect(body.results.some((item) => item.id === ids.hidden)).toBe(false);
  });
});
