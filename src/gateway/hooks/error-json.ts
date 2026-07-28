/**
 * Built-in hook: error-json
 *
 * Ensures all gateway errors return a JSON body instead of HTML.
 * If the error already produced a JSON response, passes through.
 */
import { registerHook, type GatewayContext } from '../hooks.ts';

registerHook({
  name: 'error-json',
  phase: 'onError',
  handler(ctx: GatewayContext) {
    const msg = ctx.error?.message ?? 'Internal gateway error';
    console.warn(`[Gateway] error: ${msg}`);

    return new Response(
      JSON.stringify({ error: msg, gateway: true }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
});
