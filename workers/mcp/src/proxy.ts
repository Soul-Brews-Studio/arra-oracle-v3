import { requireActiveTenant, type TenantRegistryEnv } from './tenant-registry.ts';

export type OracleProxyEnv = {
  ORACLE_URL?: string;
  ORACLE_HTTP_URL?: string;
  ORACLE_API?: string;
  ORACLE_TENANT_ID?: string;
  ARRA_API_TOKEN?: string;
  ARRA_API_KEY?: string;
} & TenantRegistryEnv;

export type TextToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type ProxyRequest = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  tenantId?: unknown;
  authContext?: OracleMcpAuthContext;
};

export type OracleMcpAuthContext = {
  tenantId?: unknown;
  tenant_id?: unknown;
  tenant?: unknown;
  orgId?: unknown;
  org_id?: unknown;
  organizationId?: unknown;
  organization_id?: unknown;
  claims?: Record<string, unknown>;
};

const TENANT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const TENANT_KEYS = ['tenantId', 'tenant_id', 'tenant', 'orgId', 'org_id', 'organizationId', 'organization_id'] as const;

function trimValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function tenantValueFrom(source: Record<string, unknown> | undefined): string | undefined {
  for (const key of TENANT_KEYS) {
    const value = trimValue(source?.[key]);
    if (value) return value;
  }
  return undefined;
}

function normalizeTenantId(value: unknown): string | undefined {
  const tenant = trimValue(value);
  if (!tenant) return undefined;
  if (!TENANT_PATTERN.test(tenant)) throw new Error('invalid tenant id');
  return tenant;
}

export function resolveMcpTenantId(
  authContext: OracleMcpAuthContext | undefined,
  explicitTenantId?: unknown,
  env?: OracleProxyEnv,
): string | undefined {
  return normalizeTenantId(
    tenantValueFrom(authContext) ??
    tenantValueFrom(authContext?.claims) ??
    trimValue(env?.ORACLE_TENANT_ID) ??
    explicitTenantId
  );
}

export function resolveOracleUrl(env: OracleProxyEnv): string {
  const raw = env.ORACLE_URL ?? env.ORACLE_HTTP_URL ?? env.ORACLE_API;
  const trimmed = raw?.trim();
  if (!trimmed) throw new Error('Set ORACLE_URL to the Arra Oracle HTTP backend.');
  const url = new URL(trimmed);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

export function buildProxyUrl(baseUrl: string, path: string, query?: Record<string, unknown>): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${suffix}`);
  for (const [key, raw] of Object.entries(query ?? {})) {
    const value = trimValue(raw);
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

function responseText(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function textResult(payload: unknown, isError = false): TextToolResult {
  return {
    content: [{ type: 'text', text: responseText(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

function proxyHeaders(env: OracleProxyEnv, hasBody: boolean, tenantId?: string): Headers {
  const headers = new Headers({ accept: 'application/json' });
  if (hasBody) headers.set('content-type', 'application/json');
  if (tenantId) {
    headers.set('X-Tenant-ID', tenantId);
    headers.set('X-Oracle-Tenant', tenantId);
    headers.set('X-Oracle-Tenant-ID', tenantId);
  }
  const token = env.ARRA_API_TOKEN?.trim() || env.ARRA_API_KEY?.trim();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function oracleProxyTool(
  env: OracleProxyEnv,
  request: ProxyRequest,
  fetcher: typeof fetch = fetch,
): Promise<TextToolResult> {
  try {
    const baseUrl = resolveOracleUrl(env);
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    const requestedTenantId = resolveMcpTenantId(request.authContext, request.tenantId, env);
    const tenantId = await requireActiveTenant(env, requestedTenantId);
    const response = await fetcher(buildProxyUrl(baseUrl, request.path, request.query), {
      method: request.method ?? 'GET',
      headers: proxyHeaders(env, body !== undefined, tenantId),
      body,
    });
    return textResult(await readPayload(response), !response.ok);
  } catch (error) {
    return textResult({
      error: error instanceof Error ? error.message : String(error),
    }, true);
  }
}
