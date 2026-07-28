/**
 * Route matcher — compiles glob patterns to RegExp at startup.
 *
 * Three pattern types:
 *   - Exact:    `/api/similar`       — matches only that path
 *   - Prefix:   `/api/vector/**`     — matches path and all sub-paths
 *   - Wildcard: `/api/map*`          — matches anything starting with prefix
 *
 * First match wins.
 */
import type { RouteConfig } from './config.ts';

export interface CompiledRoute {
  regex: RegExp;
  service: string;
  fallback?: 'fts5' | 'empty' | 'error';
  pattern: string;
}

export interface MatchedRoute {
  service: string;
  fallback?: 'fts5' | 'empty' | 'error';
  pattern: string;
}

/** Escape regex special chars (except our glob tokens). */
function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export function compileRoutes(routes: RouteConfig[]): CompiledRoute[] {
  return routes.map((r) => {
    let regexStr: string;
    if (r.match.endsWith('/**')) {
      // Prefix match: /api/vector/** -> /api/vector and /api/vector/anything
      const prefix = r.match.slice(0, -3);
      regexStr = `^${escapeRegex(prefix)}(?:/.*)?$`;
    } else if (r.match.includes('*')) {
      // Wildcard: /api/map* -> /api/map, /api/mapper, /api/map-view etc.
      const parts = r.match.split('*');
      regexStr = `^${parts.map(escapeRegex).join('.*')}$`;
    } else {
      // Exact match
      regexStr = `^${escapeRegex(r.match)}$`;
    }
    return {
      regex: new RegExp(regexStr),
      service: r.service,
      fallback: r.fallback,
      pattern: r.match,
    };
  });
}

export function matchRoute(pathname: string, routes: CompiledRoute[]): MatchedRoute | null {
  for (const r of routes) {
    if (r.regex.test(pathname)) {
      return { service: r.service, fallback: r.fallback, pattern: r.pattern };
    }
  }
  return null;
}
