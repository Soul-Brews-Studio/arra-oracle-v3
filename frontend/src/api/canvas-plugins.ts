import { API_BASE } from './oracle';

export type CanvasPluginKind = 'three' | 'react';

interface BaseCanvasPluginEntry {
  id: string;
  label: string;
  description: string;
  kind: CanvasPluginKind;
  path: string;
  query: { plugin: string };
}

export interface ThreeCanvasPluginEntry extends BaseCanvasPluginEntry {
  kind: 'three';
  mount: string;
}

export interface ReactCanvasPluginEntry extends BaseCanvasPluginEntry {
  kind: 'react';
  renderer: string;
  apiPath?: string;
}

export type CanvasPluginEntry = ThreeCanvasPluginEntry | ReactCanvasPluginEntry;

export interface CanvasPluginsResponse {
  plugins: CanvasPluginEntry[];
  count: number;
  kind: CanvasPluginKind | 'all';
}

function urlFor(path: string): string {
  if (!API_BASE) return path;
  return new URL(path, API_BASE).toString();
}

export async function fetchCanvasPlugins(kind?: CanvasPluginKind): Promise<CanvasPluginsResponse> {
  const query = kind ? `?${new URLSearchParams({ kind }).toString()}` : '';
  const path = `/api/canvas/plugins${query}`;
  const response = await fetch(urlFor(path), { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return await response.json() as CanvasPluginsResponse;
}
