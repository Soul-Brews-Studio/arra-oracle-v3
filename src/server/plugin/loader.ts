import { Elysia } from 'elysia';

import { parseDisabledPlugins, parseEnabledPlugins, validateServerPlugin } from './manifest.ts';
import type {
  ElysiaApp,
  LoadedServerPlugin,
  LoadServerPluginsOptions,
  ServerPlugin,
  ServerPluginLifecycleContext,
  ServerPluginLifecycleOptions,
  ServerPluginRoutesOptions,
  StartedServerPlugins,
} from './types.ts';

export function disabledPluginsFromEnv(): string[] {
  const disabled = parseDisabledPlugins(process.env.ORACLE_DISABLED_PLUGINS ?? process.env.ARRA_DISABLED_PLUGINS);
  if (process.env.FED_ENABLED?.toLowerCase() === 'false') disabled.push('federation');
  return [...new Set(disabled)];
}

export function enabledPluginsFromEnv(): string[] {
  const enabled = parseEnabledPlugins(process.env.ORACLE_ENABLED_PLUGINS ?? process.env.ARRA_ENABLED_PLUGINS);
  if (process.env.FED_ENABLED?.toLowerCase() === 'true') enabled.push('federation');
  return [...new Set(enabled)];
}

function isEnabled(plugin: ServerPlugin, enabled: Set<string>): boolean {
  if (plugin.enabled !== false) return true;
  return enabled.has('*') || enabled.has(plugin.name);
}

function isDisabled(plugin: ServerPlugin, disabled: Set<string>, enabled: Set<string>): boolean {
  if (!isEnabled(plugin, enabled)) return true;
  return disabled.has('*') || disabled.has(plugin.name);
}

export function loadServerPlugins(
  plugins: ServerPlugin[],
  options: LoadServerPluginsOptions = {},
): LoadedServerPlugin[] {
  const disabled = new Set(options.disabledPlugins ?? []);
  const enabled = new Set(options.enabledPlugins ?? []);
  return plugins.map((plugin) => {
    validateServerPlugin(plugin);
    if (plugin.tier === 'core') {
      if (plugin.enabled === false || disabled.has(plugin.name)) {
        throw new Error(`Cannot disable core server plugin "${plugin.name}"`);
      }
      return { plugin, disabled: false };
    }
    return { plugin, disabled: isDisabled(plugin, disabled, enabled) };
  });
}

export function enabledServerPlugins(loaded: LoadedServerPlugin[]): ServerPlugin[] {
  return loaded.filter((entry) => !entry.disabled).map((entry) => entry.plugin);
}

interface PluginRouteApps {
  plugin: ServerPlugin;
  routes: ElysiaApp[];
}

interface RouteSignature {
  method: string;
  path: string;
}

function routeApps(plugin: ServerPlugin): ElysiaApp[] {
  const routes = plugin.routes?.();
  if (!routes) return [];
  return Array.isArray(routes) ? routes : [routes];
}

function normalizePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const withoutTrailing = withSlash.replace(/\/+$/, '');
  return withoutTrailing || '/';
}

function joinPaths(prefix: string, path: string): string {
  const base = normalizePath(prefix);
  const child = normalizePath(path);
  if (child === '/') return base;
  if (base === '/') return child;
  return `${base}${child}`;
}

function routeSignatures(routes: ElysiaApp[], prefix = '', fallbackMethods: string[] = []): RouteSignature[] {
  const signatures: RouteSignature[] = [];
  for (const app of routes as Array<ElysiaApp & { routes?: Array<{ method?: string; path?: string }> }>) {
    for (const route of app.routes ?? []) {
      const path = joinPaths(prefix, route.path ?? '/');
      const method = route.method?.toUpperCase();
      if (method) {
        signatures.push({ method, path });
        continue;
      }
      for (const fallback of fallbackMethods) signatures.push({ method: fallback.toUpperCase(), path });
    }
  }
  if (signatures.length === 0 && prefix && fallbackMethods.length > 0) {
    for (const fallback of fallbackMethods) {
      signatures.push({ method: fallback.toUpperCase(), path: normalizePath(prefix) });
    }
  }
  return signatures;
}

function routeSignatureKey(signature: RouteSignature): string {
  return `${signature.method} ${signature.path}`;
}

function manifestMountedRoutes(plugin: ServerPlugin, routes: ElysiaApp[]): ElysiaApp[] {
  const api = plugin.api;
  if (!api) return routes;
  return routes.map((route) => new Elysia().group(api.path, (app) => app.use(route as any)));
}

export function serverPluginRoutes(
  plugins: ServerPlugin[],
  options: ServerPluginRoutesOptions = {},
): ElysiaApp[] {
  const entries: PluginRouteApps[] = plugins.map((plugin) => ({ plugin, routes: routeApps(plugin) }));
  const directSignatures = new Set(
    entries
      .filter((entry) => !entry.plugin.api)
      .flatMap((entry) => routeSignatures(entry.routes))
      .map(routeSignatureKey),
  );
  const claimedSignatures = new Set(directSignatures);
  const mounted: ElysiaApp[] = [];

  for (const { plugin, routes } of entries) {
    if (routes.length === 0) continue;
    if (!plugin.api) {
      mounted.push(...routes);
      continue;
    }

    const fallbackMethods = plugin.api.methods ?? [];
    const signatures = routeSignatures(routes, plugin.api.path, fallbackMethods);
    const directCollision = signatures.find((signature) => directSignatures.has(routeSignatureKey(signature)));
    if (directCollision) {
      options.warn?.(
        `[server-plugin] skipped api mount for "${plugin.name}" at ${routeSignatureKey(directCollision)}: direct route wins`,
      );
      continue;
    }
    const claimedCollision = signatures.find((signature) => claimedSignatures.has(routeSignatureKey(signature)));
    if (claimedCollision) {
      options.warn?.(
        `[server-plugin] skipped api mount for "${plugin.name}" at ${routeSignatureKey(claimedCollision)}: route already mounted`,
      );
      continue;
    }
    for (const signature of signatures) claimedSignatures.add(routeSignatureKey(signature));
    mounted.push(...manifestMountedRoutes(plugin, routes));
  }

  return mounted;
}

export function menuSeedRoutes(plugins: ServerPlugin[]): ElysiaApp[] {
  return serverPluginRoutes(plugins.filter((plugin) => plugin.seedMenu));
}

const defaultLogger = {
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

function lifecycleContext(
  abortController: AbortController,
  options: ServerPluginLifecycleOptions,
): ServerPluginLifecycleContext {
  return {
    dataDir: options.dataDir,
    vectorUrl: options.vectorUrl,
    signal: abortController.signal,
    logger: options.logger ?? defaultLogger,
  };
}

export async function startServerPlugins(
  plugins: ServerPlugin[],
  options: ServerPluginLifecycleOptions,
): Promise<StartedServerPlugins> {
  const abortController = options.abortController ?? new AbortController();
  const context = lifecycleContext(abortController, options);
  const started: ServerPlugin[] = [];
  let stopped = false;

  try {
    for (const plugin of plugins) {
      await plugin.start?.(context);
      started.push(plugin);
    }
  } catch (error) {
    abortController.abort(error);
    await stopServerPlugins(started, context);
    throw error;
  }

  return {
    plugins: started,
    context,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      abortController.abort();
      await stopServerPlugins(started, context);
    },
  };
}

export async function stopServerPlugins(
  plugins: ServerPlugin[],
  context: ServerPluginLifecycleContext,
): Promise<void> {
  const errors: Error[] = [];
  for (const plugin of [...plugins].reverse()) {
    try {
      await plugin.stop?.(context);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      errors.push(new Error(`server plugin "${plugin.name}" stop failed: ${cause.message}`, { cause }));
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'server plugin stop failures');
}
