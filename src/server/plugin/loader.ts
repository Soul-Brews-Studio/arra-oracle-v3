import { parseDisabledPlugins, validateServerPlugin } from './manifest.ts';
import type { ElysiaApp, LoadedServerPlugin, LoadServerPluginsOptions, ServerPlugin } from './types.ts';

export function disabledPluginsFromEnv(): string[] {
  return parseDisabledPlugins(process.env.ORACLE_DISABLED_PLUGINS ?? process.env.ARRA_DISABLED_PLUGINS);
}

function isDisabled(plugin: ServerPlugin, disabled: Set<string>): boolean {
  if (plugin.enabled === false) return true;
  return disabled.has('*') || disabled.has(plugin.name);
}

export function loadServerPlugins(
  plugins: ServerPlugin[],
  options: LoadServerPluginsOptions = {},
): LoadedServerPlugin[] {
  const disabled = new Set(options.disabledPlugins ?? []);
  return plugins.map((plugin) => {
    validateServerPlugin(plugin);
    if (plugin.tier === 'core') {
      if (plugin.enabled === false || disabled.has(plugin.name)) {
        throw new Error(`Cannot disable core server plugin "${plugin.name}"`);
      }
      return { plugin, disabled: false };
    }
    return { plugin, disabled: isDisabled(plugin, disabled) };
  });
}

export function enabledServerPlugins(loaded: LoadedServerPlugin[]): ServerPlugin[] {
  return loaded.filter((entry) => !entry.disabled).map((entry) => entry.plugin);
}

export function serverPluginRoutes(plugins: ServerPlugin[]): ElysiaApp[] {
  return plugins.flatMap((plugin) => {
    const routes = plugin.routes?.();
    if (!routes) return [];
    return Array.isArray(routes) ? routes : [routes];
  });
}

export function menuSeedRoutes(plugins: ServerPlugin[]): ElysiaApp[] {
  return serverPluginRoutes(plugins.filter((plugin) => plugin.seedMenu));
}

export async function startServerPlugins(plugins: ServerPlugin[]): Promise<void> {
  for (const plugin of plugins) await plugin.start?.();
}

export async function stopServerPlugins(plugins: ServerPlugin[]): Promise<void> {
  for (const plugin of [...plugins].reverse()) await plugin.stop?.();
}
