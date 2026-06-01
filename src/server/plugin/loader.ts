import { parseDisabledPlugins, parseEnabledPlugins, validateServerPlugin } from './manifest.ts';
import type { ElysiaApp, LoadedServerPlugin, LoadServerPluginsOptions, ServerPlugin } from './types.ts';

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
