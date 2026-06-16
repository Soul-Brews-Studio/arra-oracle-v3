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

function insertDoc(id: string, project: string) {
  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: `ψ/memory/learnings/${id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project,
  }).run();
}

insertDoc(ids[0], tenantA);
insertDoc(ids[1], tenantB);

afterAll(() => {
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, ids)).run();
});

function requestForTenant(path: string, tenant: string) {
  const app = createHealthRoutes({
    vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
  });
  return createTenantFetch((request) => app.handle(request))(new Request(`http://local${path}`, {
    headers: { [TENANT_HEADER]: tenant },
  }));
}

test('tenant A stats do not include tenant B documents', async () => {
  const res = await requestForTenant('/api/stats', tenantA);
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.tenant).toEqual({ id: tenantA, scope: 'project' });
  expect(body.total_docs).toBe(1);
  expect(body.by_type.learning).toBe(1);
});

test('tenant B oracle project list does not include tenant A project', async () => {
  const res = await requestForTenant('/api/oracles?hours=1', tenantB);
  const body = await res.json() as Record<string, any>;
  const projects = body.projects.map((item: { project: string }) => item.project);

  expect(res.status).toBe(200);
  expect(body.tenant).toEqual({ id: tenantB, scope: 'project' });
  expect(projects).toContain(tenantB);
  expect(projects).not.toContain(tenantA);
});
