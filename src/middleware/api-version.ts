import { Elysia } from 'elysia';

export const API_VERSION = 'v1';
export const API_VERSION_HEADER = 'X-API-Version';
const API_PREFIX = '/api';
const VERSIONED_PREFIX = `${API_PREFIX}/${API_VERSION}`;
const INFRASTRUCTURE_PREFIXES = ['/api/health'];
const publicPaths = new WeakMap<Request, string>();

type FetchHandler = (request: Request) => Response | Promise<Response>;

type HeaderSet = { headers: Record<string, string | number> };

function setVersionHeader(set: HeaderSet): void {
  set.headers[API_VERSION_HEADER] = API_VERSION;
}

function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

function isVersionedApiPath(pathname: string): boolean {
  return pathname === VERSIONED_PREFIX || pathname.startsWith(`${VERSIONED_PREFIX}/`);
}

function isInfrastructurePath(pathname: string): boolean {
  return INFRASTRUCTURE_PREFIXES.includes(pathname);
}

export function apiRequestPath(request: Request): string {
  return publicPaths.get(request) ?? new URL(request.url).pathname;
}

function versionedLocation(request: Request): string | null {
  const url = new URL(request.url);
  if (
    !isApiPath(url.pathname)
    || isVersionedApiPath(url.pathname)
    || isInfrastructurePath(url.pathname)
  ) return null;
  const suffix = url.pathname.slice(API_PREFIX.length);
  url.pathname = `${VERSIONED_PREFIX}${suffix}`;
  return url.toString();
}

function rewriteVersionedRequest(request: Request): Request {
  const url = new URL(request.url);
  if (!isVersionedApiPath(url.pathname)) return request;
  const publicPath = url.pathname;
  const suffix = url.pathname.slice(VERSIONED_PREFIX.length);
  url.pathname = `${API_PREFIX}${suffix}`;
  const rewritten = new Request(url.toString(), request);
  publicPaths.set(rewritten, publicPath);
  return rewritten;
}

function withVersionHeader(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(API_VERSION_HEADER, API_VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 308,
    headers: {
      Location: location,
      [API_VERSION_HEADER]: API_VERSION,
    },
  });
}

export function createApiVersionHeaderMiddleware() {
  return new Elysia({ name: 'api-version-header' })
    .onAfterHandle({ as: 'global' }, ({ set }) => {
      setVersionHeader(set);
    })
    .onError({ as: 'global' }, ({ set }) => {
      setVersionHeader(set);
    });
}

export async function handleApiVersionedRequest(
  request: Request,
  next: FetchHandler,
): Promise<Response> {
  const location = versionedLocation(request);
  if (location) return redirectResponse(location);
  return withVersionHeader(await next(rewriteVersionedRequest(request)));
}

export function createApiVersionedFetch(next: FetchHandler): FetchHandler {
  return (request) => handleApiVersionedRequest(request, next);
}
