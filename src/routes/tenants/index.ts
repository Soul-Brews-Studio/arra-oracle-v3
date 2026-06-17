import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, tenants } from '../../db/index.ts';
import { DEFAULT_TENANT_ID } from '../../middleware/tenant.ts';

const TenantBody = t.Object({
  id: t.String({ minLength: 1 }),
  name: t.Optional(t.String()),
  status: t.Optional(t.Union([t.Literal('active'), t.Literal('disabled')])),
});
const TENANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function now() { return Date.now(); }

function normalizeTenantId(value: string): string | null {
  const id = value.trim();
  return TENANT_ID_PATTERN.test(id) ? id : null;
}

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
  .post('/tenants', ({ body, set }) => {
    const input = body as { id: string; name?: string; status?: 'active' | 'disabled' };
    const id = normalizeTenantId(input.id);
    if (!id) {
      set.status = 400;
      return { error: 'Invalid tenant id. Use 1-128 letters, numbers, dot, underscore, colon, or dash.' };
    }
    const row = {
      id,
      name: input.name?.trim() || id,
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
    const id = normalizeTenantId(params.id);
    if (!id) {
      set.status = 400;
      return { error: 'Invalid tenant id' };
    }
    const tenant = db.select().from(tenants).where(eq(tenants.id, id)).get();
    if (!tenant) {
      set.status = 404;
      return { error: `Tenant not found: ${id}` };
    }
    return { tenant };
  }, { params: t.Object({ id: t.String({ minLength: 1 }) }) });
