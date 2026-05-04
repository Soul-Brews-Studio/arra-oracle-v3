/**
 * Gateway Elysia plugin — wires config + matcher + proxy into onRequest.
 *
 * If no config file and no VECTOR_URL → no-op (all routes local).
 * If matched service = "local" → fall through to Elysia handlers.
 * If matched service has a URL → proxy to upstream.
 */
import { Elysia } from 'elysia';
import { loadGatewayConfig, type GatewayConfig } from './config.ts';
import { compileRoutes, matchRoute, type CompiledRoute } from './matcher.ts';
import { proxyToService } from './proxy.ts';
import { HealthRegistry, type ServiceHealth } from './health.ts';

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

  console.log(
    `[Gateway] Loaded ${config.routes.length} route(s), ${Object.keys(config.services).length} service(s)`,
  );

  return new Elysia({ name: 'gateway' })
    .get('/api/gateway/status', () => ({
      enabled: true,
      routes: config.routes.length,
      services: Object.fromEntries(
        Object.entries(config.services).map(([k, v]) => [k, { url: v.url, timeout: v.timeout }]),
      ),
    }))
    .get('/api/gateway/health', () => ({
      services: registry.getAllStatus(),
    }))
    .onRequest(({ request }) => {
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
        // 'fts5' fallback = let Elysia handle it locally
        if (fallback === 'fts5') return;
        // 'error' or default
        return new Response(
          JSON.stringify({ error: 'Service unavailable', service: match.service }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return proxyToService(request, service);
    });
}
