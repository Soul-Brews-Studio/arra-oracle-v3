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
import { loadGatewayConfig, watchGatewayConfig, type GatewayConfig } from './config.ts';
import { compileRoutes, matchRoute, type CompiledRoute } from './matcher.ts';
import { proxyToService } from './proxy.ts';
import { HealthRegistry, type ServiceHealth } from './health.ts';
import { loadHooks, runHooks, type GatewayContext } from './hooks.ts';

// Register built-in hooks (side-effect imports)
import './hooks/request-logger.ts';
import './hooks/error-json.ts';
import './hooks/auth-guard.ts';
import './hooks/fts5-fallback.ts';
import './hooks/rate-limit.ts';

export { loadGatewayConfig, compileRoutes, matchRoute, proxyToService, HealthRegistry };
export type { GatewayConfig, CompiledRoute, ServiceHealth };

/**
 * Mutable state holder so the watcher can swap routes/services/hooks in
 * place without restarting the Elysia plugin. The request handler reads
 * from `state.*` at request time, so the swap takes effect immediately.
 */
interface GatewayState {
  config: GatewayConfig;
  compiled: CompiledRoute[];
  hooks: ReturnType<typeof loadHooks>;
  registry: HealthRegistry;
}

function describeState(state: GatewayState): string {
  const hookCount =
    state.hooks.onRequest.length + state.hooks.onResponse.length + state.hooks.onError.length;
  return (
    `${state.config.routes.length} route(s), ${Object.keys(state.config.services).length} service(s)` +
    (hookCount > 0 ? `, ${hookCount} hook(s)` : '')
  );
}

function emptyFallbackResponse(pathname: string): Response {
  let payload: Record<string, unknown>;

  if (pathname === '/api/map3d') {
    payload = {
      documents: [],
      total: 0,
      pca_info: {
        variance_explained: [],
        n_vectors: 0,
        n_dimensions: 0,
        computed_at: new Date().toISOString(),
      },
      source: 'gateway-fallback',
    };
  } else if (pathname === '/api/map') {
    payload = { documents: [], total: 0, source: 'gateway-fallback' };
  } else {
    payload = { results: [], source: 'gateway-fallback' };
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serviceUnavailableResponse(service: string): Response {
  return new Response(JSON.stringify({ error: 'Service unavailable', service }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

function gatewayErrorHandlerFailure(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[Gateway] error hook failed: ${message}`);
  return new Response(JSON.stringify({ error: 'Gateway error handler failed', gateway: true }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function runErrorHooks(state: GatewayState, ctx: GatewayContext): Promise<Response | void> {
  try {
    return await runHooks(state.hooks.onError, ctx);
  } catch (error) {
    return gatewayErrorHandlerFailure(error);
  }
}

export function gatewayPlugin(dataDir: string, vectorUrl?: string) {
  const initial = loadGatewayConfig(dataDir, vectorUrl);

  if (!initial && process.env.ORACLE_GATEWAY_HOT_RELOAD === '0') {
    // No config + no hot-reload — pure no-op
    return new Elysia({ name: 'gateway' });
  }

  // Even when no config exists at startup, install the watcher so the
  // gateway can pick up a file that's created later (unless explicitly
  // disabled via ORACLE_GATEWAY_HOT_RELOAD=0).
  const buildState = (cfg: GatewayConfig): GatewayState => {
    const registry = new HealthRegistry();
    registry.start(cfg.services);
    return {
      config: cfg,
      compiled: compileRoutes(cfg.routes),
      hooks: loadHooks(cfg.hooks),
      registry,
    };
  };

  let state: GatewayState | null = initial ? buildState(initial) : null;
  if (state) console.log(`[Gateway] Loaded ${describeState(state)}`);

  if (process.env.ORACLE_GATEWAY_HOT_RELOAD !== '0') {
    watchGatewayConfig(
      dataDir,
      (next) => {
        // Stop the old health poller before swapping — it holds a timer.
        if (state) state.registry.stop();
        if (next) {
          state = buildState(next);
          console.log(`[Gateway] Reloaded — ${describeState(state)}`);
        } else {
          state = null;
          console.log('[Gateway] Reloaded — disabled (no config)');
        }
      },
      vectorUrl,
    );
  }

  return new Elysia({ name: 'gateway' })
    .get('/api/gateway/status', () => {
      if (!state) return { enabled: false };
      return {
        enabled: true,
        routes: state.config.routes.length,
        services: Object.fromEntries(
          Object.entries(state.config.services).map(([k, v]) => [
            k,
            { url: v.url, timeout: v.timeout },
          ]),
        ),
        hooks:
          state.hooks.onRequest.length +
          state.hooks.onResponse.length +
          state.hooks.onError.length,
      };
    })
    .get('/api/gateway/health', () => ({
      services: state ? state.registry.getAllStatus() : {},
    }))
    .onRequest(async ({ request }) => {
      if (!state) return; // no config loaded — fall through

      const url = new URL(request.url);
      const match = matchRoute(url.pathname, state.compiled);
      if (!match) return; // no match — fall through to local Elysia routes

      const service = state.config.services[match.service];
      if (!service || match.service === 'local') return; // "local" = handle locally

      // If health registry says service is down, return fallback immediately
      if (!state.registry.isUp(match.service)) {
        const fallback = match.fallback ?? 'error';
        if (fallback === 'empty') return emptyFallbackResponse(url.pathname);
        if (fallback === 'fts5') return;
        return serviceUnavailableResponse(match.service);
      }

      const ctx: GatewayContext = {
        request,
        route: match,
        service,
        // Surface per-hook options so hooks can be config-driven without
        // module-level globals. Hooks read ctx.meta.hook_options['<name>'].
        meta: { hook_options: state.config.hook_options ?? {} },
      };

      // ── onRequest hooks ──
      try {
        const early = await runHooks(state.hooks.onRequest, ctx);
        if (early) return early;
      } catch (err) {
        ctx.error = err instanceof Error ? err : new Error(String(err));
        const errResp = await runErrorHooks(state, ctx);
        if (errResp) return errResp;
        if (ctx.meta.fallback_to_local) return; // fall through to local Elysia
        throw err;
      }

      // ── Proxy ──
      let response: Response;
      try {
        response = await proxyToService(request, service);
      } catch (err) {
        ctx.error = err instanceof Error ? err : new Error(String(err));
        const errResp = await runErrorHooks(state, ctx);
        if (errResp) return errResp;
        if (ctx.meta.fallback_to_local) return; // fall through to local Elysia
        throw err;
      }

      // proxyToService converts network/timeout failures into 502/504
      // responses. Apply route-level fallback here too; otherwise a down
      // VECTOR_URL would bypass the intended FTS5/empty degradation path.
      if (response.status === 502 || response.status === 504) {
        const fallback = match.fallback ?? 'error';
        if (fallback === 'empty') return emptyFallbackResponse(url.pathname);
        if (fallback === 'fts5') return;
      }

      // ── onResponse hooks ──
      ctx.response = response;
      try {
        const override = await runHooks(state.hooks.onResponse, ctx);
        if (override) return override;
      } catch (err) {
        ctx.error = err instanceof Error ? err : new Error(String(err));
        const errResp = await runErrorHooks(state, ctx);
        if (errResp) return errResp;
        if (ctx.meta.fallback_to_local) return;
        throw err;
      }

      return response;
    });
}
