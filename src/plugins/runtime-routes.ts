import { Elysia } from 'elysia';
import type { UnifiedRuntime } from './unified-loader.ts';
import { methodNotAllowedResponse, type RouteLike } from '../middleware/not-found.ts';

type ElysiaApp = Elysia<any, any, any, any, any, any, any>;
type RuntimeRouteSource = Pick<UnifiedRuntime, 'routes'>;
type RouteDecision = { kind: 'allowed' } | { kind: 'method-not-allowed'; allowed: string[] } | { kind: 'none' };
type RuntimeRouteDecision =
  | { kind: 'route'; app: ElysiaApp }
  | { kind: 'method-not-allowed'; allowed: string[] }
  | { kind: 'none' };

export interface UnifiedRuntimeRef<T = UnifiedRuntime> {
  current: T;
}

export interface RuntimeRouteMountOptions {
  localRoutes?: () => RouteLike[];
}

const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALL_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export function createUnifiedRuntimeRef<T>(runtime: T): UnifiedRuntimeRef<T> {
  return { current: runtime };
}

export function createUnifiedPluginRouteMount(
  runtimeRef: UnifiedRuntimeRef<RuntimeRouteSource>,
  options: RuntimeRouteMountOptions = {},
) {
  return new Elysia({ name: 'unified:runtime-routes' }).onRequest(async ({ request }) => {
    if (routeDecision(options.localRoutes?.() ?? [], request, false).kind === 'allowed') return;
    const match = runtimeRouteFor(runtimeRef.current.routes, request);
    if (match.kind === 'none') return;
    if (match.kind === 'method-not-allowed') {
      return Response.json(methodNotAllowedResponse(request, match.allowed), {
        status: 405,
        headers: { Allow: match.allowed.join(', ') },
      });
    }
    return match.app.handle(request);
  });
}

function runtimeRouteFor(routes: ElysiaApp[], request: Request): RuntimeRouteDecision {
  const allowed = new Set<string>();
  for (const app of routes) {
    const decision = routeDecision((app.routes ?? []) as RouteLike[], request, true);
    if (decision.kind === 'allowed') return { kind: 'route', app };
    if (decision.kind === 'method-not-allowed') decision.allowed.forEach((method) => allowed.add(method));
  }
  return allowed.size ? { kind: 'method-not-allowed', allowed: sortedMethods(allowed) } : { kind: 'none' };
}

function routeDecision(routes: RouteLike[], request: Request, includeAll: boolean): RouteDecision {
  const pathname = new URL(request.url).pathname;
  const requestMethod = request.method.toUpperCase();
  const allowed = new Set<string>();
  for (const route of routes) {
    const method = route.method?.toUpperCase();
    if (!method || (!includeAll && (method === 'ALL' || route.path === '*'))) continue;
    if (!pathMatches(route.path, pathname)) continue;
    const methods = method === 'ALL' ? ALL_METHODS : [method, ...(method === 'GET' ? ['HEAD'] : [])];
    if (methods.includes(requestMethod)) return { kind: 'allowed' };
    methods.forEach((value) => allowed.add(value));
  }
  return allowed.size ? { kind: 'method-not-allowed', allowed: sortedMethods(allowed) } : { kind: 'none' };
}

function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern === '*' || pattern === pathname) return true;
  const patternParts = trim(pattern).split('/');
  const pathParts = trim(pathname).split('/');
  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i];
    const value = pathParts[i];
    if (part === '*') return true;
    if (value == null) return false;
    if (part.startsWith(':')) continue;
    if (part.endsWith('*')) return value.startsWith(part.slice(0, -1));
    if (part !== value) return false;
  }
  return patternParts.length === pathParts.length;
}

function trim(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, '');
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
