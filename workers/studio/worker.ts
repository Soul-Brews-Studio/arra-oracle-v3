export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  ORACLE_URL?: string;
  ORACLE_HTTP_URL?: string;
  ORACLE_API?: string;
  MCP_URL?: string;
  ORACLE_MCP_URL?: string;
  ARRA_API_TOKEN?: string;
  ARRA_API_KEY?: string;
}

const IMMUTABLE_ASSET = /\/(?:assets\/|[^/]+-)[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;
const PLACEHOLDER = 'replace-with-your-oracle-backend';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return proxyToBackend(request, env);
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return proxyToMcp(request, env);
    }

    const response = await env.ASSETS.fetch(request);
    if (!response.ok) return response;

    const headers = new Headers(response.headers);
    if (isImmutableAsset(url.pathname)) {
      headers.set('cache-control', 'public, max-age=31536000, immutable');
    } else {
      headers.set('cache-control', 'public, max-age=3600, stale-while-revalidate=86400');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

function isImmutableAsset(pathname: string): boolean {
  return pathname.startsWith('/assets/') || IMMUTABLE_ASSET.test(pathname);
}

function proxyToBackend(request: Request, env: Env): Promise<Response> | Response {
  const base = firstConfigured(env.ORACLE_URL, env.ORACLE_HTTP_URL, env.ORACLE_API);
  if (!base) return missingConfig('ORACLE_URL', 'https://oracle.example.com');
  return proxyRequest(request, base, undefined, env);
}

function proxyToMcp(request: Request, env: Env): Promise<Response> | Response {
  const base = firstConfigured(env.MCP_URL, env.ORACLE_MCP_URL);
  if (!base) return missingConfig('MCP_URL', 'https://arra-oracle-mcp.<account>.workers.dev/mcp');
  return proxyRequest(request, base, '/mcp', env);
}

function firstConfigured(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !trimmed.includes(PLACEHOLDER)) return trimmed;
  }
  return null;
}

function proxyRequest(
  request: Request,
  base: string,
  stripPrefix: string | undefined,
  env: Env,
): Promise<Response> {
  const target = targetUrl(base, new URL(request.url), stripPrefix);
  const headers = new Headers(request.headers);
  headers.delete('host');

  const token = firstConfigured(env.ARRA_API_TOKEN, env.ARRA_API_KEY);
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  return fetch(new Request(target, init));
}

function targetUrl(base: string, requestUrl: URL, stripPrefix: string | undefined): URL {
  const target = new URL(base);
  const basePath = target.pathname.replace(/\/$/, '');
  let suffix = requestUrl.pathname;
  if (stripPrefix && (suffix === stripPrefix || suffix.startsWith(`${stripPrefix}/`))) {
    suffix = suffix.slice(stripPrefix.length) || '/';
  }
  target.pathname = suffix === '/'
    ? (basePath || '/')
    : `${basePath}${suffix.startsWith('/') ? suffix : `/${suffix}`}`.replace(/\/{2,}/g, '/');
  target.search = requestUrl.search;
  return target;
}

function missingConfig(name: string, example: string): Response {
  return Response.json({
    error: `${name} is not configured`,
    message: `Set ${name} in workers/studio/wrangler.jsonc or with wrangler secret/vars.`,
    example,
  }, {
    status: 502,
    headers: { 'cache-control': 'no-store' },
  });
}
