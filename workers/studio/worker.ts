interface StudioEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  ORACLE_URL?: string;
  ORACLE_HTTP_URL?: string;
  ORACLE_API?: string;
  ORACLE_MCP_URL?: string;
  ARRA_API_TOKEN?: string;
  ARRA_API_KEY?: string;
}

const HASHED_ASSET = /\/(?:assets\/|[^/]+-)[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;
const API_PATH = /^\/api(?:\/|$)/;

function backendBase(env: StudioEnv): string | undefined {
  return env.ORACLE_URL?.trim() || env.ORACLE_HTTP_URL?.trim() || env.ORACLE_API?.trim();
}

function joinTarget(base: string, path: string, search: string): string {
  const url = new URL(base);
  const basePath = url.pathname.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  url.pathname = `${basePath}${suffix}`;
  url.search = search;
  url.hash = '';
  return url.toString();
}

function mcpTarget(env: StudioEnv, search: string): string | undefined {
  const base = env.ORACLE_MCP_URL?.trim();
  if (base) {
    const url = new URL(base);
    url.search = search;
    url.hash = '';
    return url.toString();
  }
  const backend = backendBase(env);
  return backend ? joinTarget(backend, '/mcp', search) : undefined;
}

function token(env: StudioEnv): string | undefined {
  return env.ARRA_API_TOKEN?.trim() || env.ARRA_API_KEY?.trim() || undefined;
}

function proxyHeaders(request: Request, env: StudioEnv): Headers {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.delete('cf-ray');
  const bearer = token(env);
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  return headers;
}

function jsonError(error: string, status = 502): Response {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}

async function proxy(request: Request, env: StudioEnv, target: string): Promise<Response> {
  const init: RequestInit = {
    method: request.method,
    headers: proxyHeaders(request, env),
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  const response = await fetch(target, init);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function assets(request: Request, env: StudioEnv): Promise<Response> {
  const url = new URL(request.url);
  const response = await env.ASSETS.fetch(request);
  if (!response.ok) return response;

  const headers = new Headers(response.headers);
  headers.set('cache-control', HASHED_ASSET.test(url.pathname)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600, stale-while-revalidate=86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handleStudioRequest(request: Request, env: StudioEnv): Promise<Response> {
  const url = new URL(request.url);
  if (API_PATH.test(url.pathname)) {
    const base = backendBase(env);
    return base ? proxy(request, env, joinTarget(base, url.pathname, url.search)) : jsonError('Set ORACLE_URL for API proxy.');
  }
  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
    const target = mcpTarget(env, url.search);
    return target ? proxy(request, env, target) : jsonError('Set ORACLE_MCP_URL or ORACLE_URL for MCP proxy.');
  }
  return assets(request, env);
}

export default {
  fetch: handleStudioRequest,
};
