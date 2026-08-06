import type { LoadedUnifiedPlugin } from './unified-loader.ts';

type VisitState = 'visited' | 'visiting';

export interface PluginDependencyResolverOptions {
  warn?: (message: string) => void;
}

function warn(options: PluginDependencyResolverOptions, message: string): void {
  options.warn?.(`[unified-plugin] ${message}`);
}

export function sortPluginsByDependencies(
  plugins: LoadedUnifiedPlugin[],
  options: PluginDependencyResolverOptions = {},
): LoadedUnifiedPlugin[] {
  const byName = new Map(plugins.map((plugin) => [plugin.manifest.name, plugin]));
  const sorted: LoadedUnifiedPlugin[] = [];
  const states = new Map<string, VisitState>();

  const visit = (plugin: LoadedUnifiedPlugin, trail: string[]) => {
    const name = plugin.manifest.name;
    const state = states.get(name);
    if (state === 'visited') return;
    if (state === 'visiting') {
      warn(options, `dependency cycle ignored: ${[...trail, name].join(' -> ')}`);
      return;
    }

    states.set(name, 'visiting');
    for (const dependencyName of plugin.manifest.depends) {
      const dependency = byName.get(dependencyName);
      if (!dependency) {
        warn(options, `missing dependency "${dependencyName}" for plugin "${name}"`);
        continue;
      }
      visit(dependency, [...trail, name]);
    }
    states.set(name, 'visited');
    sorted.push(plugin);
  };

  for (const plugin of plugins) visit(plugin, []);
  return sorted;
}
