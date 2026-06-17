export interface StudioWorkerEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  ORACLE_URL?: string;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const WORKER_HEADER = 'x-oracle-studio-worker';
const WORKER_NAME = 'arra-oracle-studio';
const HASHED_ASSET = /\/(?:assets\/|[^/]+-)[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;
const HOP_BY_HOP_HEADERS = [
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      [WORKER_HEADER]: WORKER_NAME,
    },
  });
}

function resolveOracleUrl(env: StudioWorkerEnv): string | null {
  const value = env.ORACLE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function proxyUrl(baseUrl: string, requestUrl: URL): string {
  return `${baseUrl}${requestUrl.pathname}${requestUrl.search}`;
}

function proxyHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  headers.set(WORKER_HEADER, WORKER_NAME);
  return headers;
}

async function proxyApi(request: Request, env: StudioWorkerEnv, fetcher: Fetcher): Promise<Response> {
  const baseUrl = resolveOracleUrl(env);
  if (!baseUrl) {
    return json({ error: 'oracle_url_required', message: 'Set ORACLE_URL for the Studio API proxy.' }, 503);
  }

  const target = proxyUrl(baseUrl, new URL(request.url));
  const init: RequestInit = {
    method: request.method,
    headers: proxyHeaders(request),
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

  const response = await fetcher(target, init);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set(WORKER_HEADER, WORKER_NAME);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveAsset(request: Request, env: StudioWorkerEnv, pathname: string): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if (!response.ok) return response;

  const headers = new Headers(response.headers);
  headers.set('cache-control', HASHED_ASSET.test(pathname)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600, stale-while-revalidate=86400');
  headers.set(WORKER_HEADER, WORKER_NAME);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleStudioRequest(
  request: Request,
  env: StudioWorkerEnv,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (isApiPath(url.pathname)) return proxyApi(request, env, fetcher);
  return serveAsset(request, env, url.pathname);
}

export default {
  fetch: handleStudioRequest,
};
