import { describe, expect, test } from 'bun:test';
import { fetchPluginsFromEndpoint } from '../../../frontend/src/hooks/usePlugins';
import type { PluginEntry } from '../../../frontend/src/types';

const plugin: PluginEntry = { name: 'echo', file: 'echo.ts', size: 42, modified: 'now' };

describe('plugin endpoint store edge cases', () => {
  test('falls back to plugin length when backend count is malformed', async () => {
    await expect(fetchPluginsFromEndpoint({
      fetcher: () => new Response(JSON.stringify({ plugins: [plugin], dir: '/plugins', count: 'many' })),
    })).resolves.toEqual({ plugins: [plugin], dir: '/plugins', count: 1 });
  });

  test('reports unavailable and rejected fetch contexts with endpoint details', async () => {
    const previousFetch = globalThis.fetch;
    Reflect.deleteProperty(globalThis, 'fetch');
    try {
      await expect(fetchPluginsFromEndpoint()).rejects.toThrow('/api/plugins is unreachable: fetch is unavailable');
    } finally {
      globalThis.fetch = previousFetch;
    }

    await expect(fetchPluginsFromEndpoint({
      endpoint: '/api/plugins?surface=mcp',
      fetcher: () => { throw new Error('offline'); },
    })).rejects.toThrow('/api/plugins?surface=mcp is unreachable: offline');
  });
});
