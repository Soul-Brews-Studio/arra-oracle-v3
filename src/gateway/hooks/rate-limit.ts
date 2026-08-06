/**
 * Built-in hook: rate-limit
 *
 * Per-tenant, per-key token bucket. The key is read from a request header
 * (default x-forwarded-for) — fall back to "anonymous" when the header is
 * missing so the bucket still meters traffic, just bucketed by tenant.
 *
 * Options (via ctx.meta.hook_options['rate-limit']):
 *   header?: string             // header to read for the key (default x-forwarded-for)
 *   tokens_per_window?: number  // tokens refilled per window (default 60)
 *   window_ms?: number          // window duration in ms (default 60000 = 1 min)
 *   burst?: number              // max bucket size (default = tokens_per_window)
 *
 * Returns 429 with Retry-After (seconds) when a bucket is empty.
 *
 * In-memory only — per-process. If the gateway runs as multiple instances,
 * each enforces its own limit. Acceptable for the lean MVP; Redis-backed
 * variant can come later.
 */
import { registerHook, type GatewayContext } from '../hooks.ts';
import { currentTenantId, tenantIdFor } from '../../middleware/tenant.ts';

interface RateLimitOptions {
  header?: string;
  tokens_per_window?: number;
  window_ms?: number;
  burst?: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const DEFAULTS = {
  header: 'x-forwarded-for',
  tokens_per_window: 60,
  window_ms: 60_000,
} as const;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Module-level state — per-process bucket map keyed by client identifier.
const buckets = new Map<string, Bucket>();

/** Exposed for tests — clear the in-memory state between scenarios. */
export function _resetRateLimitState(): void {
  buckets.clear();
}

function extractKey(request: Request, header: string): string {
  // X-Forwarded-For can be a comma-separated chain. Use the leftmost (the
  // originating client) — see RFC 7239 / standard reverse-proxy convention.
  const raw = request.headers.get(header);
  if (!raw) return 'anonymous';
  return raw.split(',')[0].trim() || 'anonymous';
}

function configuredHeader(value: unknown): string {
  const header = typeof value === 'string' ? value.trim() : '';
  return header && HEADER_NAME.test(header) ? header : DEFAULTS.header;
}

function numericOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function tenantBucketKey(request: Request, clientKey: string): string {
  const tenantId = currentTenantId() ?? tenantIdFor(request) ?? 'default';
  return `tenant:${tenantId}|client:${clientKey}`;
}

function refill(bucket: Bucket, ratePerMs: number, max: number, now: number): void {
  const elapsed = now - bucket.lastRefill;
  if (elapsed <= 0) return;
  const refilled = elapsed * ratePerMs;
  bucket.tokens = Math.min(max, bucket.tokens + refilled);
  bucket.lastRefill = now;
}

registerHook({
  name: 'rate-limit',
  phase: 'onRequest',
  handler(ctx: GatewayContext): Response | void {
    const opts =
      (ctx.meta.hook_options as Record<string, RateLimitOptions> | undefined)?.['rate-limit'] ??
      {};
    const headerName = configuredHeader(opts.header);
    const tokensPerWindow = numericOption(opts.tokens_per_window, DEFAULTS.tokens_per_window);
    const windowMs = numericOption(opts.window_ms, DEFAULTS.window_ms);
    const burst = numericOption(opts.burst, tokensPerWindow);

    if (tokensPerWindow <= 0 || windowMs <= 0 || burst <= 0) return; // disabled / malformed

    const ratePerMs = tokensPerWindow / windowMs;
    const now = Date.now();
    const key = tenantBucketKey(ctx.request, extractKey(ctx.request, headerName));

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, lastRefill: now };
      buckets.set(key, bucket);
    } else {
      refill(bucket, ratePerMs, burst, now);
    }

    if (bucket.tokens < 1) {
      const deficit = 1 - bucket.tokens;
      const retryMs = Math.ceil(deficit / ratePerMs);
      const retryAfter = Math.max(1, Math.ceil(retryMs / 1000));
      return new Response(
        JSON.stringify({ error: 'rate_limited', retry_after_seconds: retryAfter }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        },
      );
    }

    bucket.tokens -= 1;
  },
});
