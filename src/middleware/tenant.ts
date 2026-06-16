import { AsyncLocalStorage } from 'node:async_hooks';
import { Elysia } from 'elysia';
import { eq, type SQL } from 'drizzle-orm';

export const TENANT_HEADER = 'X-Oracle-Tenant';
export const LEGACY_TENANT_HEADER = 'X-Tenant-Id';
export const ORG_HEADER = 'X-Org-Id';
const TENANT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

type TenantContext = { tenantId?: string };
type ProjectColumn = { project: unknown };
type FetchHandler = (request: Request) => Response | Promise<Response>;

const tenantStore = new AsyncLocalStorage<TenantContext>();
const tenants = new WeakMap<Request, string | undefined>();

export function tenantIdFromHeaders(headers: Headers): string | undefined {
  const raw = headers.get(TENANT_HEADER) ?? headers.get(LEGACY_TENANT_HEADER) ?? headers.get(ORG_HEADER);
  const tenant = raw?.trim();
  if (!tenant) return undefined;
  if (!TENANT_PATTERN.test(tenant)) throw new Error('invalid tenant id');
  return tenant;
}

export function rememberTenant(request: Request, tenantId: string | undefined): void {
  tenants.set(request, tenantId);
}

export function tenantIdFor(request: Request): string | undefined {
  if (tenants.has(request)) return tenants.get(request);
  const tenantId = tenantIdFromHeaders(request.headers);
  rememberTenant(request, tenantId);
  return tenantId;
}

export function currentTenantId(): string | undefined {
  return tenantStore.getStore()?.tenantId;
}

export function runWithTenant<T>(tenantId: string | undefined, callback: () => T): T {
  return tenantStore.run({ tenantId }, callback);
}

export function tenantProjectWhere<T extends ProjectColumn>(table: T): SQL | undefined {
  const tenantId = currentTenantId();
  return tenantId ? eq(table.project as never, tenantId) : undefined;
}

export function createTenantMiddleware() {
  return new Elysia({ name: 'tenant-context' })
    .derive({ as: 'global' }, ({ request, set }) => {
      try {
        const tenantId = tenantIdFor(request);
        if (tenantId) set.headers[TENANT_HEADER] = tenantId;
        return { tenantId };
      } catch (error) {
        set.status = 400;
        return { tenantId: undefined, tenantError: error instanceof Error ? error.message : String(error) };
      }
    })
    .onBeforeHandle({ as: 'global' }, ({ tenantError }) => {
      if (tenantError) return { error: tenantError };
    })
    .onRequest(({ request }) => {
      tenantIdFor(request);
    });
}

export function createTenantFetch(next: FetchHandler): FetchHandler {
  return (request) => {
    try {
      const tenantId = tenantIdFor(request);
      return runWithTenant(tenantId, () => next(request));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  };
}
