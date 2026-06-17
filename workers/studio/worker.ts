type AssetFetcher = { fetch(request: Request): Promise<Response> };

export interface StudioEnv {
  ASSETS: AssetFetcher;
  ORACLE_ORIGIN_URL?: string;
  ORACLE_URL?: string;
  ORACLE_HTTP_URL?: string;
  ORACLE_API?: string;
  ORACLE_MCP_URL?: string;
  ARRA_API_TOKEN?: string;
  ARRA_API_KEY?: string;
}

const WORKER_HEADER = 'oracle-studio-worker';
const STRIPPED_PROXY_HEADERS = [
  'host', 'content-length', 'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-for',
  'x-real-ip',
] as const;
const API_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
const MCP_METHODS = 'GET, HEAD, POST, DELETE, OPTIONS';

export default {
  fetch: handleStudioRequest,
};

export async function handleStudioRequest(request: Request, env: StudioEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/__health') return health();
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') return apiPreflight();
    return proxyApiRequest(request, env);
  }
  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
    if (request.method === 'OPTIONS') return mcpPreflight();
    return proxyMcpRequest(request, env);
  }
  return serveAsset(request, env);
}

async function proxyApiRequest(request: Request, env: StudioEnv): Promise<Response> {
  try {
    const target = apiTarget(resolveOracleUrl(env), new URL(request.url));
    return proxyRequest(request, env, target, { 'access-control-allow-origin': '*' });
  } catch (error) {
    return json({ error: 'api proxy failed', message: message(error) }, 502);
  }
}

async function proxyMcpRequest(request: Request, env: StudioEnv): Promise<Response> {
  try {
    return proxyRequest(request, env, mcpTarget(env, new URL(request.url)), {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'mcp-session-id, x-oracle-studio-worker',
    });
  } catch (error) {
    return json({ error: 'mcp proxy failed', message: message(error) }, 502);
  }
}

async function proxyRequest(
  request: Request,
  env: StudioEnv,
  target: string,
  extraHeaders: Record<string, string>,
): Promise<Response> {
  const upstream = await fetch(target, {
    method: request.method,
    headers: proxyHeaders(request.headers, env),
    body: hasRequestBody(request.method) ? request.body : undefined,
    redirect: 'manual',
  });
  return withHeaders(upstream, {
    'cache-control': 'no-store',
    'x-oracle-studio-worker': WORKER_HEADER,
    'access-control-expose-headers': 'x-oracle-studio-worker',
    ...extraHeaders,
  });
}

function resolveMcpUrl(env: StudioEnv): string {
  const direct = env.ORACLE_MCP_URL?.trim();
  if (direct) return sanitizedHttpUrl(direct, 'ORACLE_MCP_URL');
  return `${resolveOracleUrl(env)}/mcp`;
}

function resolveOracleUrl(env: StudioEnv): string {
  const candidates = [
    ['ORACLE_ORIGIN_URL', env.ORACLE_ORIGIN_URL],
    ['ORACLE_URL', env.ORACLE_URL],
    ['ORACLE_HTTP_URL', env.ORACLE_HTTP_URL],
    ['ORACLE_API', env.ORACLE_API],
  ] as const;
  const match = candidates.find(([, value]) => value?.trim());
  if (!match) throw new Error('Set ORACLE_ORIGIN_URL to the Oracle backend.');
  const [label, raw] = match;
  return sanitizedHttpUrl(raw!.trim(), label);
}

function sanitizedHttpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must be http(s).`);
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

function apiTarget(baseUrl: string, requestUrl: URL): string {
  return prefixedTarget(baseUrl, requestUrl, '');
}

function mcpTarget(env: StudioEnv, requestUrl: URL): string {
  return prefixedTarget(resolveMcpUrl(env), requestUrl, '/mcp');
}

function prefixedTarget(baseUrl: string, requestUrl: URL, prefix: string): string {
  const suffix = prefix ? requestUrl.pathname.slice(prefix.length) : requestUrl.pathname;
  const target = new URL(baseUrl);
  const basePath = target.pathname.replace(/\/+$/, '');
  const cleanSuffix = suffix.replace(/^\/+/, '');
  target.pathname = cleanSuffix ? `${basePath}/${cleanSuffix}`.replace(/\/+/g, '/') : basePath || '/';
  target.search = requestUrl.search;
  return target.toString();
}

function proxyHeaders(source: Headers, env: StudioEnv): Headers {
  const headers = new Headers(source);
  for (const key of STRIPPED_PROXY_HEADERS) headers.delete(key);
  headers.set('x-oracle-studio-worker', WORKER_HEADER);
  const bearer = authToken(env);
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  return headers;
}

function authToken(env: StudioEnv): string | undefined {
  return env.ARRA_API_TOKEN?.trim() || env.ARRA_API_KEY?.trim() || undefined;
}

async function serveAsset(request: Request, env: StudioEnv): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const url = new URL(request.url);
  const cache = cacheControlFor(url.pathname, response.headers.get('content-type'));
  return withHeaders(response, {
    ...(cache ? { 'cache-control': cache } : {}),
    'x-oracle-studio-worker': WORKER_HEADER,
  });
}

function cacheControlFor(pathname: string, contentType: string | null): string | undefined {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (contentType?.includes('text/html') || !pathname.split('/').pop()?.includes('.')) {
    return 'public, max-age=3600, stale-while-revalidate=86400';
  }
  return undefined;
}

function withHeaders(response: Response, values: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(values)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function mcpPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: MCP_METHODS,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': MCP_METHODS,
      'access-control-allow-headers': 'authorization, content-type, accept, mcp-session-id, mcp-protocol-version',
      'access-control-expose-headers': 'mcp-session-id, x-oracle-studio-worker',
      'cache-control': 'no-store',
      'x-oracle-studio-worker': WORKER_HEADER,
    },
  });
}

function apiPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: API_METHODS,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': API_METHODS,
      'access-control-allow-headers': 'authorization, content-type, x-oracle-tenant, x-tenant-id',
      'access-control-expose-headers': 'x-oracle-studio-worker',
      'cache-control': 'no-store',
      'x-oracle-studio-worker': WORKER_HEADER,
    },
  });
}

function health(): Response {
  return json({ ok: true, app: 'arra-oracle-studio-worker' }, 200);
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-oracle-studio-worker': WORKER_HEADER,
    },
  });
}

function hasRequestBody(method: string): boolean {
  return !['GET', 'HEAD'].includes(method.toUpperCase());
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
