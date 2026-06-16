import type { LoadedServerPlugin, ServerPlugin } from './types.ts';

const registry: LoadedServerPlugin[] = [];

export function registerServerPlugins(plugins: LoadedServerPlugin[]): void {
  registry.length = 0;
  registry.push(...plugins);
}

export function resolveServerPlugin(name: string): LoadedServerPlugin | null {
  return registry.find((p) => p.plugin.name === name) ?? null;
}

export function listServerPlugins(): LoadedServerPlugin[] {
  return [...registry];
}

export function pluginNames(plugins: ServerPlugin[]): string[] {
  return plugins.map((p) => p.name);
}
