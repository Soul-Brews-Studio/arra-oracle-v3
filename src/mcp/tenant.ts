import { TENANT_HEADER, tenantIdFromHeaders } from '../middleware/tenant.ts';

const MCP_TENANT_ARG_KEYS = ['tenantId', 'tenant_id', 'tenant', 'orgId', 'org_id'] as const;

/** X-Oracle-Tenant from an MCP request's HTTP headers (SDK requestInfo), if any. */
export function headerTenant(headers: Record<string, string | string[] | undefined> | undefined): string | undefined {
  const raw = headers?.[TENANT_HEADER.toLowerCase()] ?? headers?.[TENANT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

export function tenantIdFromMcpArgs(args: Record<string, unknown>, fromRequest?: string): string | undefined {
  const explicit = MCP_TENANT_ARG_KEYS
    .map((key) => args[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const fallback = process.env.ORACLE_TENANT_ID?.trim() || process.env.ORACLE_TENANT?.trim();
  const tenant = explicit?.trim() || fromRequest || fallback || undefined;
  return tenant ? tenantIdFromHeaders(new Headers({ [TENANT_HEADER]: tenant })) : undefined;
}

export function stripMcpTenantArgs(args: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...args };
  for (const key of MCP_TENANT_ARG_KEYS) delete stripped[key];
  return stripped;
}

export function mcpTenantHeaders(tenantId: string | undefined): Record<string, string> {
  const trimmed = tenantId?.trim();
  if (!trimmed) return {};
  const validated = tenantIdFromHeaders(new Headers({ [TENANT_HEADER]: trimmed }));
  return validated ? { [TENANT_HEADER]: validated } : {};
}
