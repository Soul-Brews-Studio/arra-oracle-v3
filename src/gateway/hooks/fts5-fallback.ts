/**
 * Built-in hook: fts5-fallback
 *
 * onError hook for proxy failures. Sets `ctx.meta.fallback_to_local = true`
 * so the gateway request handler falls through to the local Elysia routes
 * instead of rethrowing the proxy error to the client. The local handlers
 * still serve FTS5 search via the normal `/api/search` etc.
 *
 * No options needed — the route's existing `fallback: 'fts5'` config
 * already documents intent. This hook adds the equivalent behavior for
 * runtime proxy errors (timeout, 502, refused) on routes where the
 * route-level fallback is set to something else.
 */
import { registerHook, type GatewayContext } from '../hooks.ts';

registerHook({
  name: 'fts5-fallback',
  phase: 'onError',
  handler(ctx: GatewayContext): void {
    // Mark the request for local fall-through. The gateway request handler
    // checks this flag in its proxy catch block before rethrowing.
    ctx.meta.fallback_to_local = true;
    const url = new URL(ctx.request.url);
    console.log(
      `[Gateway] fts5-fallback: ${url.pathname} → local (proxy err: ${ctx.error?.message ?? 'unknown'})`,
    );
  },
});
