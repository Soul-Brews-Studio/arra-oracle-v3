import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createTenantFetch, currentTenantId, TENANT_HEADER } from '../../../src/middleware/tenant.ts';

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const docs = [
  { id: `tenant-doc-a-${stamp}`, project: tenantA, type: 'learning', createdAt: Date.now() },
  { id: `tenant-doc-b-${stamp}`, project: tenantB, type: 'learning', createdAt: Date.now() },
];

function tenantDocs() {
  const tenantId = currentTenantId();
  return docs.filter((doc) => !tenantId || doc.project === tenantId);
}

function createTenantAwareHealthApp() {
  return new Elysia({ prefix: '/api' })
    .get('/stats', () => {
      const scoped = tenantDocs();
      return {
        tenant: { id: currentTenantId(), scope: 'project' },
        total_docs: scoped.length,
        by_type: scoped.reduce<Record<string, number>>((counts, doc) => {
          counts[doc.type] = (counts[doc.type] ?? 0) + 1;
          return counts;
        }, {}),
      };
    })
    .get('/oracles', () => {
      const projects = tenantDocs().map((doc) => ({
        project: doc.project,
        docs: 1,
        types: 1,
        last_indexed: doc.createdAt,
      }));
      return { tenant: { id: currentTenantId(), scope: 'project' }, projects };
    });
}

function requestForTenant(path: string, tenant: string) {
  const app = createTenantAwareHealthApp();
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
