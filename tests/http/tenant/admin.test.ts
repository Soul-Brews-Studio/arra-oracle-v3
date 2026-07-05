import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, resetDefaultDatabaseForTests, tenants } from '../../../src/db/index.ts';

resetDefaultDatabaseForTests();
import { tenantsRoutes } from '../../../src/routes/tenants/index.ts';

const tenantId = `admin-tenant-${Date.now()}-${Math.random().toString(16).slice(2)}`;

afterAll(() => {
  db.delete(tenants).where(eq(tenants.id, tenantId)).run();
});

test('tenant admin API creates and lists tenants', async () => {
  const created = await tenantsRoutes.handle(new Request('http://local/api/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: tenantId, name: 'Admin Tenant' }),
  }));
  expect(created.status).toBe(200);
  expect(await created.json()).toMatchObject({ success: true, tenant: { id: tenantId, status: 'active' } });

  const listed = await tenantsRoutes.handle(new Request('http://local/api/tenants'));
  const body = await listed.json() as { tenants: Array<{ id: string }> };
  expect(body.tenants.map((tenant) => tenant.id)).toContain(tenantId);
});

test('tenant admin API rejects blank or unsafe tenant ids', async () => {
  for (const id of ['   ', '../escape', 'bad tenant']) {
    const res = await tenantsRoutes.handle(new Request('http://local/api/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }));
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('tenant id');
  }

  expect(db.select().from(tenants).where(eq(tenants.id, '')).get()).toBeUndefined();
});
