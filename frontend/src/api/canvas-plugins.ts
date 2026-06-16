import { API_BASE } from './oracle';

export type CanvasPluginKind = 'three' | 'react';

interface BaseCanvasPluginEntry {
  id: string;
  label: string;
  description: string;
  kind: CanvasPluginKind;
  path?: string;
  query?: { plugin: string };
  standalonePath?: string;
  renderer?: string;
  apiPath?: string;
}

export interface ThreeCanvasPluginEntry extends BaseCanvasPluginEntry {
  kind: 'three';
  mount?: string;
}

export interface ReactCanvasPluginEntry extends BaseCanvasPluginEntry {
  kind: 'react';
  renderer: string;
}

export type CanvasPluginEntry = ThreeCanvasPluginEntry | ReactCanvasPluginEntry;

export interface CanvasPluginsResponse {
  plugins: CanvasPluginEntry[];
  count: number;
  kind: CanvasPluginKind | 'all' | 'canvas';
  standalone?: {
    host: string;
    defaultPlugin: string;
    serveCommand?: string;
  };
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
