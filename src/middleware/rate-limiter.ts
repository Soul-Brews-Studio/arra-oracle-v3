import { Elysia } from 'elysia';
import { API_VERSION, apiRequestPath } from './api-version.ts';
import { apiErrorResponse } from './errors.ts';

export type RateLimitRule = {
  path: string | RegExp;
  limit: number;
  windowMs: number;
  methods?: string[];
};

export type RateLimitOptions = {
  rules?: RateLimitRule[];
  now?: () => number;
  key?: (request: Request) => string;
};

type Bucket = { count: number; resetAt: number };
type HeaderSetter = { status?: number | string; headers: Record<string, string | number> };

export const DEFAULT_RATE_LIMIT_RULES: RateLimitRule[] = [
  { path: '/api/search', limit: 30, windowMs: 60_000 },
  { path: '/api/learn', limit: 10, windowMs: 60_000 },
];

function methodAllowed(rule: RateLimitRule, method: string): boolean {
  return !rule.methods || rule.methods.map((m) => m.toUpperCase()).includes(method.toUpperCase());
}

function pathMatches(rule: RateLimitRule, pathname: string): boolean {
  return typeof rule.path === 'string' ? pathname === rule.path : rule.path.test(pathname);
}

function canonicalApiPath(pathname: string): string {
  const versionedRoot = `/api/${API_VERSION}`;
  if (pathname === versionedRoot) return '/api';
  return pathname.startsWith(`${versionedRoot}/`) ? `/api${pathname.slice(versionedRoot.length)}` : pathname;
}

export function matchingRateLimitRule(request: Request, rules = DEFAULT_RATE_LIMIT_RULES): RateLimitRule | undefined {
  const pathname = canonicalApiPath(apiRequestPath(request));
  return rules.find((rule) => methodAllowed(rule, request.method) && pathMatches(rule, pathname));
}

export function clientRateLimitKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = request.headers.get('cf-connecting-ip')?.trim() || forwarded || 'local';
  return `${request.method.toUpperCase()} ${canonicalApiPath(apiRequestPath(request))} ${clientIp}`;
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(0, Math.ceil((resetAt - now) / 1000));
}

function setHeaders(set: HeaderSetter, rule: RateLimitRule, bucket: Bucket, now: number) {
  set.headers['RateLimit-Limit'] = rule.limit;
  set.headers['RateLimit-Remaining'] = Math.max(0, rule.limit - bucket.count);
  set.headers['RateLimit-Reset'] = secondsUntil(bucket.resetAt, now);
}

export function createRateLimiterMiddleware(options: RateLimitOptions = {}) {
  const rules = options.rules ?? DEFAULT_RATE_LIMIT_RULES;
  const now = options.now ?? Date.now;
  const keyFor = options.key ?? clientRateLimitKey;
  const buckets = new Map<string, Bucket>();

  return new Elysia({ name: 'rate-limiter' }).onBeforeHandle({ as: 'global' }, ({ request, set }) => {
    const rule = matchingRateLimitRule(request, rules);
    if (!rule) return;

    const at = now();
    const key = keyFor(request);
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= at ? { count: 0, resetAt: at + rule.windowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    setHeaders(set, rule, bucket, at);

    if (bucket.count <= rule.limit) return;
    set.status = 429;
    set.headers['Retry-After'] = secondsUntil(bucket.resetAt, at);
    return apiErrorResponse('rate_limit_exceeded', 429, {
      limit: rule.limit,
      windowMs: rule.windowMs,
      retryAfterSeconds: secondsUntil(bucket.resetAt, at),
    });
  });
}
