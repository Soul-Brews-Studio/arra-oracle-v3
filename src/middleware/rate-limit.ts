/**
 * Rate Limiting Middleware
 *
 * In-memory sliding window rate limiter for Hono.
 * Tracks requests per IP with configurable window and limits.
 */
import type { Context, MiddlewareHandler } from 'hono';

export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests per window per IP */
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(config: RateLimitConfig) {
  const store = new Map<string, WindowEntry>();

  // Periodic cleanup of expired entries (every 60s)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 60_000);

  // Allow cleanup interval to not prevent process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  function check(ip: string): RateLimitResult {
    const now = Date.now();
    const entry = store.get(ip);

    // Window expired or first request — start fresh
    if (!entry || entry.resetAt <= now) {
      store.set(ip, { count: 1, resetAt: now + config.windowMs });
      return { allowed: true, remaining: config.maxRequests - 1, retryAfterMs: 0 };
    }

    // Within window — check count
    if (entry.count < config.maxRequests) {
      entry.count++;
      return {
        allowed: true,
        remaining: config.maxRequests - entry.count,
        retryAfterMs: 0,
      };
    }

    // Over limit
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: entry.resetAt - now,
    };
  }

  function reset(ip: string): void {
    store.delete(ip);
  }

  return { check, reset };
}

/** Rate limit tiers */
export const RATE_LIMIT_TIERS = {
  /** Auth endpoints: 5 req/min (brute-force protection) */
  auth: { windowMs: 60_000, maxRequests: 5 },
  /** Write endpoints: 20 req/min */
  write: { windowMs: 60_000, maxRequests: 20 },
  /** Read endpoints: 100 req/min */
  read: { windowMs: 60_000, maxRequests: 100 },
} as const;

function getClientIp(c: Context): string {
  const connInfo = (c.env as Record<string, unknown>)?.remoteAddress;
  return (typeof connInfo === 'string' ? connInfo : null) || '127.0.0.1';
}

/**
 * Create Hono middleware for rate limiting.
 */
export function rateLimitMiddleware(config: RateLimitConfig): MiddlewareHandler {
  const limiter = createRateLimiter(config);

  return async (c, next) => {
    const ip = getClientIp(c);
    const result = limiter.check(ip);

    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json(
        { error: 'Too many requests', retryAfterMs: result.retryAfterMs },
        429
      );
    }

    return next();
  };
}
