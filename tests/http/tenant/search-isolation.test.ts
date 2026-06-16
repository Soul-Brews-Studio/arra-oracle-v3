import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { db, oracleDocuments, sqlite } from '../../../src/db/index.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { searchRoutes } from '../../../src/routes/search/index.ts';

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const ids = [`tenant-search-a-${stamp}`, `tenant-search-b-${stamp}`];
const now = Date.now();

function insertDoc(id: string, tenantId: string, content: string) {
  db.insert(oracleDocuments).values({
    id, tenantId, type: 'learning', sourceFile: `ψ/memory/${id}.md`,
    concepts: '[]', createdAt: now, updatedAt: now, indexedAt: now,
    project: tenantId, createdBy: 'test',
  }).run();
  sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(id, content, 'tenant');
}

insertDoc(ids[0], tenantA, `alpha-only-${stamp} sharedterm`);
insertDoc(ids[1], tenantB, `beta-only-${stamp} sharedterm`);

afterAll(() => {
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, ids)).run();
  for (const id of ids) sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
});

function requestSearch(tenantId: string) {
  return createTenantFetch((request) => searchRoutes.handle(request))(new Request('http://local/api/search?q=sharedterm&mode=fts', {
    headers: { [TENANT_HEADER]: tenantId },
  }));
}

test('GET /api/search returns only documents for the selected tenant', async () => {
  const res = await requestSearch(tenantA);
  const body = await res.json() as { results: Array<{ id: string }> };

  expect(res.status).toBe(200);
  expect(body.results.map((item) => item.id)).toContain(ids[0]);
  expect(body.results.map((item) => item.id)).not.toContain(ids[1]);
});
