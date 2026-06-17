type AssetFetcher = { fetch(request: Request): Promise<Response> };

export interface StudioEnv {
  ASSETS: AssetFetcher;
  ORACLE_URL?: string;
  ORACLE_HTTP_URL?: string;
  ORACLE_API?: string;
  ORACLE_MCP_URL?: string;
  MCP_URL?: string;
  ARRA_API_TOKEN?: string;
  ARRA_API_KEY?: string;
}

const WORKER_HEADER = 'oracle-studio-worker';
const API_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
const PLACEHOLDER = 'replace-with-your-oracle-backend';
const HASHED_ASSET = /\/(?:assets\/|[^/]+-)[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;

export default { fetch: handleStudioRequest };

export async function handleStudioRequest(request: Request, env: StudioEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/__health') return health();
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') return apiPreflight();
    return proxyApiRequest(request, env);
  }
  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
    if (request.method === 'OPTIONS') return apiPreflight();
    return proxyMcpRequest(request, env);
  }
  return serveAsset(request, env);
}

async function proxyApiRequest(request: Request, env: StudioEnv): Promise<Response> {
  try {
    const target = proxyTarget(resolveUrl(env.ORACLE_URL, env.ORACLE_HTTP_URL, env.ORACLE_API), new URL(request.url));
    return proxyRequest(request, env, target);
  } catch (error) {
    return json({ error: 'api proxy failed', message: message(error) }, 502);
  }
}

async function proxyMcpRequest(request: Request, env: StudioEnv): Promise<Response> {
  try {
    const target = proxyTarget(resolveMcpUrl(env), new URL(request.url), '/mcp');
    return proxyRequest(request, env, target);
  } catch (error) {
    return json({ error: 'mcp proxy failed', message: message(error) }, 502);
  }
}

async function proxyRequest(request: Request, env: StudioEnv, target: string): Promise<Response> {
  const headers = proxyHeaders(request.headers, env);
  const init: RequestInit = { method: request.method, headers, redirect: 'manual' };
  if (hasRequestBody(request.method)) init.body = request.body;
  const upstream = await fetch(target, init);
  return withHeaders(upstream, proxyResponseHeaders());
}

function resolveMcpUrl(env: StudioEnv): string {
  if (env.ORACLE_MCP_URL?.trim() || env.MCP_URL?.trim()) return resolveUrl(env.ORACLE_MCP_URL, env.MCP_URL);
  return `${resolveUrl(env.ORACLE_URL, env.ORACLE_HTTP_URL, env.ORACLE_API)}/mcp`;
}

function resolveUrl(...values: Array<string | undefined>): string {
  const raw = values.find((value) => value?.trim() && !value.includes(PLACEHOLDER));
  if (!raw) throw new Error('Set ORACLE_URL to the Oracle backend.');
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('proxy URL must be http(s).');
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

function proxyTarget(baseUrl: string, requestUrl: URL, stripPrefix?: string): string {
  let suffix = requestUrl.pathname;
  if (stripPrefix && (suffix === stripPrefix || suffix.startsWith(`${stripPrefix}/`))) {
    suffix = suffix.slice(stripPrefix.length) || '/';
  }
  const target = new URL(`${baseUrl}${suffix === '/' ? '' : suffix}`);
  target.search = requestUrl.search;
  return target.toString();
}

function proxyHeaders(source: Headers, env: StudioEnv): Headers {
  const headers = new Headers(source);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.delete('cf-ray');
  headers.set('x-oracle-studio-worker', WORKER_HEADER);
  const bearer = authToken(env);
  if (bearer && !headers.has('authorization')) headers.set('authorization', `Bearer ${bearer}`);
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
  if (pathname.startsWith('/assets/') || HASHED_ASSET.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
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

function proxyResponseHeaders(): Record<string, string> {
  return {
    'cache-control': 'no-store',
    'x-oracle-studio-worker': WORKER_HEADER,
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'x-oracle-studio-worker',
  };
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
