import type { MenuResponse, PluginsResponse } from './types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchMenu(): Promise<MenuResponse> {
  const data = await getJson<MenuResponse>('/api/menu');
  return { items: Array.isArray(data.items) ? data.items : [] };
}

export async function fetchPlugins(): Promise<PluginsResponse> {
  const data = await getJson<PluginsResponse>('/api/plugins');
  return {
    dir: typeof data.dir === 'string' ? data.dir : '',
    plugins: Array.isArray(data.plugins) ? data.plugins : [],
  };
}
