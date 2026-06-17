import { describe, expect, test } from 'bun:test';
import { fetchPluginsFromEndpoint, usePlugins } from '../../../frontend/src/hooks/usePlugins';
import type { PluginEntry } from '../../../frontend/src/types';
import { htmlFor } from '../_render';
import { requestPath } from '../api/_fetch';

const plugin: PluginEntry = { name: 'echo', file: 'echo.ts', size: 42, modified: '2026-06-16T00:00:00Z' };

function PluginsProbe({ initialLoading = false }: { initialLoading?: boolean }) {
  const state = usePlugins({ initialPlugins: [plugin], initialLoading, fetcher: async () => new Response('{}') });
  return <span>{state.loading ? 'loading' : 'ready'}:{state.count}:{state.plugins.map((item) => item.name).join(',')}</span>;
}

describe('usePlugins hook and endpoint store', () => {
  test('renders initial plugin state before client effects run', () => {
    expect(htmlFor(<PluginsProbe />)).toContain('ready:1:echo');
    expect(htmlFor(<PluginsProbe initialLoading />)).toContain('loading:1:echo');
  });

  test('normalizes plugin endpoint responses and request headers', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const response = await fetchPluginsFromEndpoint({
      endpoint: '/api/plugins?surface=ui',
      fetcher: (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify({ plugins: [plugin], dir: 123 }), { status: 200 });
      },
    });

    expect(response).toEqual({ plugins: [plugin], dir: '', count: 1 });
    expect(requestPath(calls[0]?.input ?? '')).toBe('/api/plugins?surface=ui');
    expect((calls[0]?.init?.headers as Record<string, string>).accept).toBe('application/json');
  });

  test('reports invalid JSON and non-ok plugin responses', async () => {
    await expect(fetchPluginsFromEndpoint({ fetcher: () => new Response('{bad') })).rejects.toThrow('/api/plugins returned invalid JSON');
    await expect(fetchPluginsFromEndpoint({ fetcher: () => new Response('{"error":"denied"}', { status: 403 }) })).rejects.toThrow('/api/plugins returned 403: denied');
  });
});
