import { Elysia } from 'elysia';
import { apiRequestPath } from './api-version.ts';
import { apiErrorResponse } from './errors.ts';

export type NotFoundResponse = {
  error: 'Not Found';
  code: 404;
  details: {
    path: string;
    method: string;
  };
};

export type MethodNotAllowedResponse = {
  error: 'Method Not Allowed';
  code: 405;
  details: {
    path: string;
    method: string;
    allowedMethods: string[];
  };
};

type RouteLike = { method?: string; path: string };
type RouteMatcher = { path: string; allowedMethods: Set<string> };

const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export function notFoundResponse(request: Request): NotFoundResponse {
  return apiErrorResponse('Not Found', 404, {
    path: apiRequestPath(request),
    method: request.method,
  });
}

export function methodNotAllowedResponse(
  request: Request,
  allowedMethods: string[],
): MethodNotAllowedResponse {
  return apiErrorResponse('Method Not Allowed', 405, {
    path: apiRequestPath(request),
    method: request.method,
    allowedMethods,
  });
}

function sortedMethods(methods: Set<string>): string[] {
  return [...methods].sort((a, b) => {
    const ai = METHOD_ORDER.indexOf(a);
    const bi = METHOD_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function routeMatchers(routes: RouteLike[]): RouteMatcher[] {
  const matchers = new Map<string, Set<string>>();
  for (const route of routes) {
    const method = route.method?.toUpperCase();
    if (!method || method === 'ALL' || route.path === '*') continue;
    const methods = matchers.get(route.path) ?? new Set<string>();
    methods.add(method);
    matchers.set(route.path, methods);
  }
  return [...matchers].map(([path, allowedMethods]) => ({ path, allowedMethods }));
}

function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true;
  const patternParts = pattern.replace(/^\//, '').split('/');
  const pathParts = pathname.replace(/^\//, '').split('/');
  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i];
    if (part === '*') return true;
    if (pathParts[i] == null) return false;
    if (part.startsWith(':')) continue;
    if (part !== pathParts[i]) return false;
  }
  return patternParts.length === pathParts.length;
}

function allowedMethodsFor(matchers: RouteMatcher[], request: Request): string[] | null {
  const pathname = new URL(request.url).pathname;
  for (const matcher of matchers) {
    if (!pathMatches(matcher.path, pathname)) continue;
    if (matcher.allowedMethods.has(request.method.toUpperCase())) return null;
    return sortedMethods(matcher.allowedMethods);
  }
  return null;
}

export function createNotFoundMiddleware(routes: RouteLike[] = []) {
  const matchers = routeMatchers([...routes]);
  return new Elysia({ name: 'not-found' }).all('*', ({ request, set }) => {
    const allowedMethods = allowedMethodsFor(matchers, request);
    if (allowedMethods) {
      set.status = 405;
      set.headers.Allow = allowedMethods.join(', ');
      return methodNotAllowedResponse(request, allowedMethods);
    }

    set.status = 404;
    return notFoundResponse(request);
  });
}
