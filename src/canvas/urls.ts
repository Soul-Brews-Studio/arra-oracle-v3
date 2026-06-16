export const CANVAS_HOST = 'canvas.buildwithoracle.com';
export const CANVAS_ORIGIN = `https://${CANVAS_HOST}`;
export const DEFAULT_CANVAS_PLUGIN = 'wave';

const REACT_PLUGIN_PATHS = new Set(['map', 'planets']);

export function canvasPluginPath(id: string): string {
  const plugin = id.trim() || DEFAULT_CANVAS_PLUGIN;
  if (REACT_PLUGIN_PATHS.has(plugin)) return `/${plugin}`;
  return `/?${new URLSearchParams({ plugin })}`;
}

export function canvasPluginAbsoluteUrl(id: string, origin = CANVAS_ORIGIN): string {
  return new URL(canvasPluginPath(id), origin).toString();
}

export function canvasPluginDataPath(id: string): string | undefined {
  return REACT_PLUGIN_PATHS.has(id) ? '/api/map3d' : undefined;
}
