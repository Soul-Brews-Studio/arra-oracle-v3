import { useCallback, useEffect, useState } from 'react';
import { apiUrl, withLocalPna } from '../api/oracle';
import type { PluginEntry, PluginsResponse } from '../types';

export const PLUGINS_ENDPOINT = '/api/plugins';
const EMPTY_PLUGINS: PluginEntry[] = [];

export type PluginFetch = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

export interface UsePluginsOptions {
  initialPlugins?: PluginEntry[];
  initialLoading?: boolean;
  endpoint?: string;
  fetcher?: PluginFetch;
}

export interface UsePluginsResult {
  plugins: PluginEntry[];
  dir: string;
  count: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePlugins(response: PluginsResponse): PluginsResponse {
  const plugins = Array.isArray(response.plugins) ? response.plugins : [];
  return {
    dir: typeof response.dir === 'string' ? response.dir : '',
    count: Number.isFinite(response.count) ? response.count : plugins.length,
    plugins,
  };
}

export async function fetchPluginsFromEndpoint({
  endpoint = PLUGINS_ENDPOINT,
  fetcher,
}: {
  endpoint?: string;
  fetcher?: PluginFetch;
} = {}): Promise<PluginsResponse> {
  const request = fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!request) throw new Error(`${endpoint} is unreachable: fetch is unavailable`);

  let response: Response;
  try {
    response = await request(apiUrl(endpoint), withLocalPna({ headers: { accept: 'application/json' } }));
  } catch (error) {
    throw new Error(`${endpoint} is unreachable: ${messageFor(error)}`);
  }

  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${endpoint} returned invalid JSON`);
  }

  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : response.statusText;
    throw new Error(`${endpoint} returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return normalizePlugins(payload as PluginsResponse);
}

export function usePlugins({
  initialPlugins = EMPTY_PLUGINS,
  initialLoading = true,
  endpoint = PLUGINS_ENDPOINT,
  fetcher,
}: UsePluginsOptions = {}): UsePluginsResult {
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const [result, setResult] = useState<Omit<UsePluginsResult, 'reload'>>({
    plugins: initialPlugins,
    dir: '',
    count: initialPlugins.length,
    loading: initialLoading,
    error: null,
  });

  useEffect(() => {
    if (initialLoading) return;
    setResult((current) => ({
      ...current,
      plugins: initialPlugins,
      count: initialPlugins.length,
      loading: false,
    }));
  }, [initialLoading, initialPlugins]);

  useEffect(() => {
    let active = true;
    setResult((current) => ({ ...current, loading: true, error: null }));
    fetchPluginsFromEndpoint({ endpoint, fetcher })
      .then((response) => {
        if (!active) return;
        setResult((current) => ({
          ...current,
          plugins: response.plugins,
          dir: response.dir,
          count: response.count ?? response.plugins.length,
          loading: false,
        }));
      })
      .catch((error) => {
        if (!active) return;
        setResult((current) => ({ ...current, loading: false, error: messageFor(error) }));
      });
    return () => {
      active = false;
    };
  }, [endpoint, fetcher, reloadKey]);

  return { ...result, reload };
}
