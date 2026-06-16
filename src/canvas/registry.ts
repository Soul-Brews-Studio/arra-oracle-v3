import { findCanvasPlugin, listCanvasPlugins, type CanvasPluginKind } from './plugins.ts';
import { canvasPluginPath } from './urls.ts';

const kinds = new Set<CanvasPluginKind>(['three', 'react']);

export function parseCanvasKind(value: unknown): CanvasPluginKind | undefined {
  return typeof value === 'string' && kinds.has(value as CanvasPluginKind) ? value as CanvasPluginKind : undefined;
}

export const canvasPluginUrl = canvasPluginPath;

export function canvasRegistry(kind?: CanvasPluginKind) {
  const plugins = listCanvasPlugins(kind).map((plugin) => ({
    ...plugin,
    standalonePath: canvasPluginUrl(plugin.id),
  }));
  return {
    plugins,
    count: plugins.length,
    kind: kind ?? 'all',
    standalone: {
      host: 'canvas.buildwithoracle.com',
      defaultPlugin: 'wave',
      serveCommand: 'bun run src/cli/index.ts canvas-serve --port 47779',
    },
  };
}

export function canvasPluginEntry(id: string) {
  const plugin = findCanvasPlugin(id);
  return plugin ? { plugin: { ...plugin, standalonePath: canvasPluginUrl(plugin.id) } } : null;
}
