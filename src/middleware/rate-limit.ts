import { Elysia } from 'elysia';
import { REQUEST_ID_HEADER, requestIdFor } from './correlation.ts';
import type { StructuredErrorResponse } from './errors.ts';

const DEFAULT_RPM = 60;
const DEFAULT_WINDOW_MS = 60_000;
const HEALTH_BYPASS_PATH = '/api/health';

type RateLimitOptions = {
  rpm?: number;
  windowMs?: number;
  now?: () => number;
  getIp?: (request: Request) => string;
  store?: Map<string, number[]>;
};

export function rateLimitRpmFromEnv(value = process.env.ARRA_RATE_LIMIT_RPM): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_RPM;
}

export function isRateLimitBypassed(pathname: string): boolean {
  return pathname === HEALTH_BYPASS_PATH;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || 'unknown';
}


function messageFor(limit: number, windowMs: number): string {
  return `Rate limit exceeded: ${limit} requests per ${Math.round(windowMs / 1000)} seconds`;
}

function retryAfterSeconds(timestamps: number[], now: number, windowMs: number): number {
  return Math.max(1, Math.ceil(((timestamps[0] ?? now) + windowMs - now) / 1000));
}

export function createRateLimitMiddleware(options: RateLimitOptions = {}) {
  const limit = Math.max(1, Math.floor(options.rpm ?? rateLimitRpmFromEnv()));
  const windowMs = Math.max(1, options.windowMs ?? DEFAULT_WINDOW_MS);
  const now = options.now ?? Date.now;
  const getIp = options.getIp ?? clientIp;
  const store = options.store ?? new Map<string, number[]>();

  return new Elysia({ name: 'rate-limit' }).onBeforeHandle({ as: 'global' }, ({ request, set }) => {
    const pathname = new URL(request.url).pathname;
    if (isRateLimitBypassed(pathname)) return;

    const timestamp = now();
    const key = getIp(request);
    const cutoff = timestamp - windowMs;
    const current = (store.get(key) ?? []).filter((entry) => entry > cutoff);
    if (current.length >= limit) {
      const retryAfter = retryAfterSeconds(current, timestamp, windowMs);
      const id = requestIdFor(request);
      store.set(key, current);
      set.status = 429;
      set.headers['Retry-After'] = String(retryAfter);
      set.headers[REQUEST_ID_HEADER] = id;
      set.headers['x-correlation-id'] = id;
      return {
        error: 'Too Many Requests',
        message: messageFor(limit, windowMs),
        statusCode: 429,
        correlationId: id,
      } satisfies StructuredErrorResponse;
    }

    current.push(timestamp);
    store.set(key, current);
  });
}
