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
    const headerName = opts.header ?? 'x-oracle-token';

    const pathname = new URL(ctx.request.url).pathname;
    for (const prefix of opts.allowlist ?? []) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) return;
    }

    const token = ctx.request.headers.get(headerName);
    if (!token) return unauthorized(`missing ${headerName}`);
    if (opts.expected && token !== opts.expected) return unauthorized(`invalid ${headerName}`);
  },
});
