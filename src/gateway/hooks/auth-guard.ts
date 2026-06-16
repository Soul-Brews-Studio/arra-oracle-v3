/**
 * Built-in hook: auth-guard
 *
 * Rejects requests missing a valid token. Reads its options from
 * `ctx.meta.hook_options['auth-guard']`:
 *
 *   {
 *     header: string,        // header name (default "x-oracle-token")
 *     expected?: string,     // exact match — omit to require ANY non-empty value
 *     allowlist?: string[]   // path prefixes that bypass the check (health, status)
 *   }
 *
 * Returns 401 JSON when the token is missing or mismatched.
 */
import { registerHook, type GatewayContext } from '../hooks.ts';

interface AuthGuardOptions {
  header?: string;
  expected?: string;
  allowlist?: string[];
}

const DEFAULT_HEADER = 'x-oracle-token';
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function configuredHeader(value: unknown): string {
  const header = typeof value === 'string' ? value.trim() : '';
  return header && HEADER_NAME.test(header) ? header : DEFAULT_HEADER;
}

function allowlistRoots(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', reason }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

registerHook({
  name: 'auth-guard',
  phase: 'onRequest',
  handler(ctx: GatewayContext): Response | void {
    const opts =
      (ctx.meta.hook_options as Record<string, AuthGuardOptions> | undefined)?.['auth-guard'] ??
      {};
    const headerName = configuredHeader(opts.header);

    const pathname = new URL(ctx.request.url).pathname;
    for (const prefix of allowlistRoots(opts.allowlist)) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) return;
    }

    const token = ctx.request.headers.get(headerName);
    if (!token) return unauthorized(`missing ${headerName}`);
    if (opts.expected && token !== opts.expected) return unauthorized(`invalid ${headerName}`);
  },
});
