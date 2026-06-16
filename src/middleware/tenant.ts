import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Elysia } from 'elysia';
import { eq, type SQL } from 'drizzle-orm';

export const TENANT_HEADER = 'X-Oracle-Tenant';
export const TENANT_TOKEN_HEADER = 'X-Oracle-Tenant-Token';
export const LEGACY_TENANT_HEADER = 'X-Tenant-ID';
export const ORG_HEADER = 'X-Org-Id';
export const TENANT_API_KEY_HEADER = 'X-API-Key';
const TENANT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export const DEFAULT_TENANT_ID = 'default';
type TenantContext = { tenantId?: string };
type ProjectColumn = { project: unknown };
type FetchHandler = (request: Request) => Response | Promise<Response>;
type TenantTokenMap = Record<string, string>;

const tenantStore = new AsyncLocalStorage<TenantContext>();
const tenants = new WeakMap<Request, string | undefined>();

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseTenantTokens(raw = process.env.ORACLE_TENANT_TOKENS ?? ''): TenantTokenMap {
  const value = raw.trim();
  if (!value) return {};
  if (value.startsWith('{')) return JSON.parse(value) as TenantTokenMap;
  return Object.fromEntries(value.split(',').map((entry) => {
    const [tenant, ...tokenParts] = entry.split('=');
    return [tenant.trim(), tokenParts.join('=').trim()];
  }).filter(([tenant, token]) => tenant && token));
}

export function parseTenantApiKeys(raw = process.env.ORACLE_TENANT_API_KEYS ?? ''): TenantTokenMap {
  return parseTenantTokens(raw);
}

function bearerToken(headers: Headers): string {
  const value = headers.get('authorization') ?? '';
  return value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
}

function tenantIdFromApiKey(headers: Headers, apiKeys = parseTenantApiKeys()): string | undefined {
  const actual = headers.get(TENANT_API_KEY_HEADER)?.trim() || bearerToken(headers);
  if (!actual) return undefined;
  for (const [tenantId, expected] of Object.entries(apiKeys)) {
    if (expected && safeEqual(actual, expected)) {
      if (!TENANT_PATTERN.test(tenantId)) throw new Error('invalid tenant id');
      return tenantId;
    }
  }
  return undefined;
}

export function tenantIdFromHeaders(headers: Headers): string | undefined {
  const raw = headers.get(TENANT_HEADER) ?? headers.get(LEGACY_TENANT_HEADER) ?? headers.get(ORG_HEADER);
  const tenant = raw?.trim();
  if (!tenant) return tenantIdFromApiKey(headers);
  if (!TENANT_PATTERN.test(tenant)) throw new Error('invalid tenant id');
  return tenant;
}

export function validateTenantToken(headers: Headers, tenantId: string | undefined, tokens = parseTenantTokens()): void {
  if (!tenantId) return;
  const expected = tokens[tenantId] ?? tokens['*'];
  if (!expected) return;
  const actual = headers.get(TENANT_TOKEN_HEADER)?.trim() ?? '';
  if (!actual) throw new Error('tenant token required');
  if (!safeEqual(actual, expected)) throw new Error('invalid tenant token');
}

export function rememberTenant(request: Request, tenantId: string | undefined): void {
  tenants.set(request, tenantId);
}

export function tenantIdFor(request: Request): string | undefined {
  if (tenants.has(request)) return tenants.get(request);
  const tenantId = tenantIdFromHeaders(request.headers);
  validateTenantToken(request.headers, tenantId);
  rememberTenant(request, tenantId);
  return tenantId;
}

export function currentTenantId(): string | undefined {
  return tenantStore.getStore()?.tenantId;
}

export function activeTenantId(): string {
  return currentTenantId() ?? DEFAULT_TENANT_ID;
}

export function tenantIdForWrite(): string {
  return activeTenantId();
}

export function tenantSql(alias = 'd'): { clause: string; params: string[] } {
  const tenantId = currentTenantId();
  return tenantId ? { clause: `AND ${alias}.tenant_id = ?`, params: [tenantId] } : { clause: '', params: [] };
}

export function withTenantWhere(where?: Record<string, any>): Record<string, any> | undefined {
  const tenantId = currentTenantId();
  return tenantId ? { ...(where ?? {}), tenant_id: tenantId } : where;
}

function safeTenantSegment(tenantId: string): string {
  return tenantId.replace(/[^a-zA-Z0-9._:-]/g, '_');
}

export function tenantDataPath(basePath: string): string {
  const tenantId = currentTenantId();
  if (!tenantId) return basePath;
  const root = path.dirname(basePath);
  return path.join(root, 'tenants', safeTenantSegment(tenantId), path.basename(basePath));
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
      return Response.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  };
}
