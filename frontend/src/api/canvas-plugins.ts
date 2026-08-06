import type {
  CanvasPluginKind,
  CanvasPluginMetadataEntry,
  CanvasPluginMetadataRegistry,
  CanvasPluginRegistry,
} from '@soul-brews/canvas-plugins';
import { API_BASE } from './oracle';

export type { CanvasPluginKind } from '@soul-brews/canvas-plugins';
export type CanvasPluginEntry = Omit<CanvasPluginMetadataEntry, 'renderer'> & {
  path?: string;
  query?: { plugin: string };
  renderer?: string;
  mount?: string;
};

export interface CanvasPluginsResponse {
  plugins: CanvasPluginEntry[];
  count: number;
  kind: CanvasPluginKind | 'all' | 'canvas';
  standalone?: (CanvasPluginRegistry | CanvasPluginMetadataRegistry)['standalone'];
}

function urlFor(path: string): string {
  if (!API_BASE) return path;
  return new URL(path, API_BASE).toString();
}

export async function fetchCanvasPlugins(kind?: CanvasPluginKind): Promise<CanvasPluginsResponse> {
  const query = kind ? `?${new URLSearchParams({ kind }).toString()}` : '?kind=canvas';
  const path = kind ? `/api/canvas/plugins${query}` : `/api/plugins${query}`;
  const response = await fetch(urlFor(path), { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return await response.json() as CanvasPluginsResponse;
}
