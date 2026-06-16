import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, tenants } from '../../db/index.ts';
import { DEFAULT_TENANT_ID } from '../../middleware/tenant.ts';

const TenantBody = t.Object({
  id: t.String({ minLength: 1 }),
  name: t.Optional(t.String()),
  status: t.Optional(t.Union([t.Literal('active'), t.Literal('disabled')])),
});

function now() { return Date.now(); }

function ensureDefaultTenant() {
  db.insert(tenants).values({
    id: DEFAULT_TENANT_ID,
    name: 'Default tenant',
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  }).onConflictDoNothing().run();
}

export const tenantsRoutes = new Elysia({ prefix: '/api' })
  .get('/tenants', () => {
    ensureDefaultTenant();
    const data = db.select().from(tenants).all();
    return { tenants: data, count: data.length };
  }, { detail: { tags: ['tenants'], summary: 'List tenants' } })
  .post('/tenants', ({ body }) => {
    const input = body as { id: string; name?: string; status?: 'active' | 'disabled' };
    const row = {
      id: input.id.trim(),
      name: input.name?.trim() || input.id.trim(),
      status: input.status ?? 'active',
      createdAt: now(),
      updatedAt: now(),
    };
    db.insert(tenants).values(row)
      .onConflictDoUpdate({ target: tenants.id, set: { name: row.name, status: row.status, updatedAt: row.updatedAt } })
      .run();
    return { success: true, tenant: db.select().from(tenants).where(eq(tenants.id, row.id)).get() };
  }, { body: TenantBody, detail: { tags: ['tenants'], summary: 'Create or update a tenant' } })
  .get('/tenants/:id', ({ params, set }) => {
    const tenant = db.select().from(tenants).where(eq(tenants.id, params.id)).get();
    if (!tenant) {
      set.status = 404;
      return { error: `Tenant not found: ${params.id}` };
    }
    return { tenant };
  }, { params: t.Object({ id: t.String({ minLength: 1 }) }) });
