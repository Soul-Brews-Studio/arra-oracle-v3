import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { db, oracleDocuments } from '../../../src/db/index.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const ids = [`tenant-doc-a-${stamp}`, `tenant-doc-b-${stamp}`];
const now = Date.now();

function insertDoc(id: string, tenantId: string) {
  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: `ψ/memory/learnings/${id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    tenantId,
    project: tenantId,
  }).run();
}

insertDoc(ids[0], tenantA);
insertDoc(ids[1], tenantB);

afterAll(() => {
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, ids)).run();
});

function createFetch() {
  const app = createHealthRoutes({
    vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
  });
  return createTenantFetch((request) => app.handle(request));
}

test('GET /api/stats scopes document counts by tenant header', async () => {
  const res = await createFetch()(new Request('http://local/api/stats', {
    headers: { [TENANT_HEADER]: tenantA },
  }));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.tenant).toEqual({ id: tenantA, scope: 'tenant_id' });
  expect(body.total).toBe(1);
  expect(body.by_type.learning).toBe(1);
});

test('GET /api/oracles scopes project list by tenant header', async () => {
  const res = await createFetch()(new Request('http://local/api/oracles?hours=1', {
    headers: { [TENANT_HEADER]: tenantB },
  }));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.tenant).toEqual({ id: tenantB, scope: 'tenant_id' });
  expect(body.projects.map((item: { project: string }) => item.project)).toContain(tenantB);
  expect(body.projects.map((item: { project: string }) => item.project)).not.toContain(tenantA);
});
