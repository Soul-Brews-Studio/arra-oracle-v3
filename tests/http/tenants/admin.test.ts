import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq, inArray } from 'drizzle-orm';

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests();
const { tenantsRoutes } = await import('../../../src/routes/tenants/index.ts');

const app = new Elysia().use(tenantsRoutes);
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantId = `admin-tenant-${stamp}`;
const createdIds = [tenantId];

function request(pathname: string, init: RequestInit = {}) {
  return app.handle(new Request(`http://local${pathname}`, init));
}

async function postTenant(body: unknown) {
  return request('/api/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterAll(() => {
  dbMod.db.delete(dbMod.tenants).where(inArray(dbMod.tenants.id, createdIds)).run();
});

test('GET and POST /api/tenants create, list, fetch, and update tenants', async () => {
  const created = await postTenant({ id: tenantId, name: 'Admin Tenant' });
  expect(created.status).toBe(200);
  expect(await created.json()).toMatchObject({ success: true, tenant: { id: tenantId, name: 'Admin Tenant', status: 'active' } });

  const listed = await request('/api/tenants');
  const listBody = await listed.json() as { tenants: Array<{ id: string }>; count: number };
  expect(listed.status).toBe(200);
  expect(listBody.tenants.map((tenant) => tenant.id)).toContain(tenantId);
  expect(listBody.count).toBe(listBody.tenants.length);

  const fetched = await request(`/api/tenants/${tenantId}`);
  expect(fetched.status).toBe(200);
  expect(await fetched.json()).toMatchObject({ tenant: { id: tenantId, name: 'Admin Tenant', status: 'active' } });

  const updated = await postTenant({ id: tenantId, name: 'Paused Tenant', status: 'disabled' });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ success: true, tenant: { id: tenantId, name: 'Paused Tenant', status: 'disabled' } });
});

test('tenant admin API rejects unsafe ids and returns shaped lookup errors', async () => {
  for (const id of ['   ', '../escape', 'bad tenant']) {
    const res = await postTenant({ id });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('tenant id');
  }

  expect(dbMod.db.select().from(dbMod.tenants).where(eq(dbMod.tenants.id, '')).get()).toBeUndefined();

  const invalidLookup = await request('/api/tenants/bad%2Ftenant');
  expect(invalidLookup.status).toBe(400);
  expect(await invalidLookup.json()).toEqual({ error: 'Invalid tenant id' });

  const missing = await request(`/api/tenants/missing-${stamp}`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: `Tenant not found: missing-${stamp}` });
});
