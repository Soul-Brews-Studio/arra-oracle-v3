import type { GatewayConfig } from './config.ts';
import { HealthRegistry } from './health.ts';
import { loadHooks } from './hooks.ts';
import { compileRoutes, type CompiledRoute } from './matcher.ts';

export interface GatewayState {
  config: GatewayConfig;
  compiled: CompiledRoute[];
  hooks: ReturnType<typeof loadHooks>;
  registry: HealthRegistry;
}

export function createGatewayState(config: GatewayConfig): GatewayState {
  const compiled = compileRoutes(config.routes);
  const hooks = loadHooks(config.hooks);
  const registry = new HealthRegistry();
  registry.start(config.services);
  return { config, compiled, hooks, registry };
}

export function describeGatewayState(state: GatewayState): string {
  const hookCount =
    state.hooks.onRequest.length + state.hooks.onResponse.length + state.hooks.onError.length;
  return (
    `${state.config.routes.length} route(s), ${Object.keys(state.config.services).length} service(s)` +
    (hookCount > 0 ? `, ${hookCount} hook(s)` : '')
  );
}
