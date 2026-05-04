/**
 * Gateway Elysia plugin — wires config + matcher + proxy + hooks into onRequest.
 *
 * If no config file and no VECTOR_URL → no-op (all routes local).
 * If matched service = "local" → fall through to Elysia handlers.
 * If matched service has a URL → proxy to upstream.
 *
 * Hook pipeline (optional):
 *   onRequest  → runs before proxy (can short-circuit)
 *   onResponse → runs after proxy response
 *   onError    → runs when proxy or hook throws
 */
import { Elysia } from 'elysia';
import { loadGatewayConfig, type GatewayConfig } from './config.ts';
import { compileRoutes, matchRoute, type CompiledRoute } from './matcher.ts';
import { proxyToService } from './proxy.ts';
import { HealthRegistry, type ServiceHealth } from './health.ts';
import { loadHooks, runHooks, type GatewayContext } from './hooks.ts';

// Register built-in hooks (side-effect imports)
import './hooks/request-logger.ts';
import './hooks/error-json.ts';

export { loadGatewayConfig, compileRoutes, matchRoute, proxyToService, HealthRegistry };
export type { GatewayConfig, CompiledRoute, ServiceHealth };

export function gatewayPlugin(dataDir: string, vectorUrl?: string) {
  const config = loadGatewayConfig(dataDir, vectorUrl);

  if (!config) {
    // No gateway config — all routes handled locally
    return new Elysia({ name: 'gateway' });
  }

  const compiled = compileRoutes(config.routes);
  const registry = new HealthRegistry();
  registry.start(config.services);
  const hooks = loadHooks(config.hooks);

  const hookCount =
    hooks.onRequest.length + hooks.onResponse.length + hooks.onError.length;

  console.log(
    `[Gateway] Loaded ${config.routes.length} route(s), ${Object.keys(config.services).length} service(s)` +
      (hookCount > 0 ? `, ${hookCount} hook(s)` : ''),
  );

  return new Elysia({ name: 'gateway' })
    .get('/api/gateway/status', () => ({
      enabled: true,
      routes: config.routes.length,
      services: Object.fromEntries(
        Object.entries(config.services).map(([k, v]) => [k, { url: v.url, timeout: v.timeout }]),
      ),
      hooks: hookCount,
    }))
    .get('/api/gateway/health', () => ({
      services: registry.getAllStatus(),
    }))
    .onRequest(async ({ request }) => {
      const url = new URL(request.url);
      const match = matchRoute(url.pathname, compiled);
      if (!match) return; // no match — fall through to local Elysia routes

      const service = config.services[match.service];
      if (!service || match.service === 'local') return; // "local" = handle locally

      // If health registry says service is down, return fallback immediately
      if (!registry.isUp(match.service)) {
        const fallback = match.fallback ?? 'error';
        if (fallback === 'empty') {
          return new Response(JSON.stringify({ results: [], source: 'gateway-fallback' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (fallback === 'fts5') return;
        return new Response(
          JSON.stringify({ error: 'Service unavailable', service: match.service }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const ctx: GatewayContext = {
        request,
        route: match,
        service,
        meta: {},
      };

      // ── onRequest hooks ──
      try {
        const early = await runHooks(hooks.onRequest, ctx);
        if (early) return early;
      } catch (err) {
        ctx.error = err instanceof Error ? err : new Error(String(err));
        const errResp = await runHooks(hooks.onError, ctx);
        if (errResp) return errResp;
        throw err;
      }

      // ── Proxy ──
      let response: Response;
      try {
        response = await proxyToService(request, service);
      } catch (err) {
        ctx.error = err instanceof Error ? err : new Error(String(err));
        const errResp = await runHooks(hooks.onError, ctx);
        if (errResp) return errResp;
        throw err;
      }

      // ── onResponse hooks ──
      ctx.response = response;
      try {
        const override = await runHooks(hooks.onResponse, ctx);
        if (override) return override;
      } catch (err) {
        ctx.error = err instanceof Error ? err : new Error(String(err));
        const errResp = await runHooks(hooks.onError, ctx);
        if (errResp) return errResp;
        throw err;
      }

      return response;
    });
}
