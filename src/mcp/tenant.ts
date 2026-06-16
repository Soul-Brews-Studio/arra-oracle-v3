import { TENANT_HEADER, tenantIdFromHeaders } from '../middleware/tenant.ts';

const MCP_TENANT_ARG_KEYS = ['tenantId', 'tenant_id', 'tenant', 'orgId', 'org_id'] as const;

export function tenantIdFromMcpArgs(args: Record<string, unknown>): string | undefined {
  const explicit = MCP_TENANT_ARG_KEYS
    .map((key) => args[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const fallback = process.env.ORACLE_TENANT_ID?.trim() || process.env.ORACLE_TENANT?.trim();
  const tenant = explicit?.trim() || fallback || undefined;
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
