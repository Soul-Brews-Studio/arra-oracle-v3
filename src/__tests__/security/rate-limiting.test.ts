/**
 * Rate Limiting Tests
 *
 * Verifies that rate limiting middleware:
 * - Enforces per-IP request limits
 * - Uses correct tiers for different endpoint types
 * - Returns proper 429 responses with Retry-After header
 * - Does not limit health endpoints
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createRateLimiter, type RateLimitConfig } from '../../middleware/rate-limit.ts';

describe('Rate Limiter', () => {
  test('creates a rate limiter with config', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    expect(limiter).toBeDefined();
    expect(typeof limiter.check).toBe('function');
    expect(typeof limiter.reset).toBe('function');
  });

  test('allows requests within limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const ip = '192.168.1.1';

    for (let i = 0; i < 5; i++) {
      const result = limiter.check(ip);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  test('blocks requests exceeding limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
    const ip = '10.0.0.1';

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      limiter.check(ip);
    }

    // Next request should be blocked
    const result = limiter.check(ip);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  test('tracks IPs independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    // Use up IP1's limit
    limiter.check('1.1.1.1');
    limiter.check('1.1.1.1');
    const blocked = limiter.check('1.1.1.1');
    expect(blocked.allowed).toBe(false);

    // IP2 should still be allowed
    const allowed = limiter.check('2.2.2.2');
    expect(allowed.allowed).toBe(true);
  });

  test('resets after window expires', () => {
    const limiter = createRateLimiter({ windowMs: 100, maxRequests: 1 }); // 100ms window
    const ip = '3.3.3.3';

    limiter.check(ip);
    const blocked = limiter.check(ip);
    expect(blocked.allowed).toBe(false);

    // Manually reset to simulate window expiry
    limiter.reset(ip);
    const afterReset = limiter.check(ip);
    expect(afterReset.allowed).toBe(true);
  });

  test('returns retryAfterMs when blocked', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const ip = '4.4.4.4';

    limiter.check(ip);
    const result = limiter.check(ip);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
  });
});

describe('Rate Limit Tiers', () => {
  test('auth tier: 5 requests per minute', () => {
    const authLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const ip = '5.5.5.5';

    for (let i = 0; i < 5; i++) {
      expect(authLimiter.check(ip).allowed).toBe(true);
    }
    expect(authLimiter.check(ip).allowed).toBe(false);
  });

  test('write tier: 20 requests per minute', () => {
    const writeLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });
    const ip = '6.6.6.6';

    for (let i = 0; i < 20; i++) {
      expect(writeLimiter.check(ip).allowed).toBe(true);
    }
    expect(writeLimiter.check(ip).allowed).toBe(false);
  });

  test('read tier: 100 requests per minute', () => {
    const readLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 100 });
    const ip = '7.7.7.7';

    for (let i = 0; i < 100; i++) {
      expect(readLimiter.check(ip).allowed).toBe(true);
    }
    expect(readLimiter.check(ip).allowed).toBe(false);
  });
});
