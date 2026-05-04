/**
 * Built-in hook: request-logger
 *
 * Logs request method, path, matched service, and round-trip duration.
 * Attaches a `startTime` to ctx.meta so the onResponse phase can compute duration.
 */
import { registerHook, type GatewayContext } from '../hooks.ts';

registerHook({
  name: 'request-logger',
  phase: 'onRequest',
  handler(ctx: GatewayContext) {
    ctx.meta._gwStart = performance.now();
    const url = new URL(ctx.request.url);
    const service = ctx.route?.service ?? 'local';
    console.log(`[Gateway] → ${ctx.request.method} ${url.pathname} → ${service}`);
  },
});

registerHook({
  name: 'request-logger-response',
  phase: 'onResponse',
  handler(ctx: GatewayContext) {
    const start = ctx.meta._gwStart as number | undefined;
    if (start == null) return;
    const ms = (performance.now() - start).toFixed(1);
    const status = ctx.response?.status ?? '?';
    const url = new URL(ctx.request.url);
    console.log(`[Gateway] ← ${status} ${url.pathname} (${ms}ms)`);
  },
});
