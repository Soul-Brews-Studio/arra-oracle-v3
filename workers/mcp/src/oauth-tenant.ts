export type OAuthTenantAuthContext = Record<string, unknown>;

export type TenantResolution = {
  tenantId?: string;
  source: 'auth' | 'tool' | 'none';
  error?: string;
};

const DIRECT_KEYS = [
  'tenantId',
  'tenant_id',
  'tid',
  'orgId',
  'org_id',
  'organizationId',
  'organization_id',
  'teamId',
  'team_id',
];

const NESTED_KEYS = [
  'claims',
  'token',
  'user',
  'profile',
  'metadata',
  'tenant',
  'organization',
  'org',
  'team',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTenantId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(text) ? text : undefined;
}

function namespacedTenantValue(record: Record<string, unknown>): unknown {
  for (const [key, value] of Object.entries(record)) {
    const normalized = key.toLowerCase().replace(/-/g, '_');
    if (normalized.endsWith('/tenant_id') || normalized.endsWith(':tenant_id')) {
      return value;
    }
  }
}

export function rawTenantClaim(props: unknown, depth = 0): unknown {
  if (!isRecord(props) || depth > 4) return undefined;

  for (const key of DIRECT_KEYS) {
    if (props[key] !== undefined) return props[key];
  }

  const namespaced = namespacedTenantValue(props);
  if (namespaced !== undefined) return namespaced;

  for (const key of NESTED_KEYS) {
    const nested = props[key];
    if (normalizeTenantId(nested)) return nested;
    if (isRecord(nested)) {
      const nestedId = nested.id ?? nested.slug;
      if (normalizeTenantId(nestedId)) return nestedId;
    }
    const found = rawTenantClaim(nested, depth + 1);
    if (found !== undefined) return found;
  }
}

export function tenantIdFromAuthProps(props: unknown): string | undefined {
  return normalizeTenantId(rawTenantClaim(props));
}

function hasAuthContext(props: unknown): boolean {
  return isRecord(props) && Object.keys(props).length > 0;
}

export function resolveTenantIdForRequest(
  authProps: unknown,
  requestedTenantId?: unknown,
): TenantResolution {
  const rawAuthTenant = rawTenantClaim(authProps);
  if (rawAuthTenant !== undefined) {
    const tenantId = normalizeTenantId(rawAuthTenant);
    return tenantId
      ? { tenantId, source: 'auth' }
      : { source: 'none', error: 'OAuth tenant claim is invalid.' };
  }

  if (hasAuthContext(authProps)) {
    return { source: 'none', error: 'OAuth token is missing a tenant claim.' };
  }

  const fallback = normalizeTenantId(requestedTenantId);
  return fallback ? { tenantId: fallback, source: 'tool' } : { source: 'none' };
}
