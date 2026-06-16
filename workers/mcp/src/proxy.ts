export type OracleProxyEnv = {
  ORACLE_URL?: string;
  ORACLE_HTTP_URL?: string;
  ORACLE_API?: string;
  ARRA_API_TOKEN?: string;
  ARRA_API_KEY?: string;
};

export type TextToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ProxyRequest = {
  method?: 'GET' | 'POST';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  tenantId?: unknown;
};

function trimValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
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

function proxyHeaders(env: OracleProxyEnv, hasBody: boolean, tenantId?: unknown): Headers {
  const headers = new Headers({ accept: 'application/json' });
  if (hasBody) headers.set('content-type', 'application/json');
  const tenant = trimValue(tenantId);
  if (tenant) headers.set('x-oracle-tenant-id', tenant);
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
    const response = await fetcher(buildProxyUrl(baseUrl, request.path, request.query), {
      method: request.method ?? 'GET',
      headers: proxyHeaders(env, body !== undefined, request.tenantId),
      body,
    });
    return textResult(await readPayload(response), !response.ok);
  } catch (error) {
    return textResult({
      error: error instanceof Error ? error.message : String(error),
    }, true);
  }
}
