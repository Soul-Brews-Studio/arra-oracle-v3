import { afterAll, beforeAll, expect, test } from 'bun:test';
import { startSmokeServer, type SmokeServer } from '../smoke/_helpers.ts';

type MenuItem = {
  label: string;
  path: string;
  group: string;
  order: number;
  source: string;
};

type PluginEntry = {
  name: string;
  file: string;
  size: number;
  modified: string;
  version?: string;
  description?: string;
  menu?: Record<string, unknown>;
  server?: Record<string, unknown>;
};

type SearchBody = {
  query: string;
  total: number;
  limit: number;
  offset: number;
  results: Array<Record<string, unknown>>;
};

let server: SmokeServer;

beforeAll(async () => {
  server = await startSmokeServer({
    name: 'e2e-unified-plugin-schema',
    withPlugin: true,
    vectorResponder: (url) => ({
      query: url.searchParams.get('q') ?? '',
      total: 1,
      limit: Number(url.searchParams.get('limit') ?? 1),
      offset: 0,
      results: [{
        id: 'smoke-vector-doc',
        type: 'learning',
        content: 'Unified plugin vector search smoke result',
        source_file: 'plugins/smoke-orbit.md',
        concepts: ['plugin', 'smoke'],
        source: 'vector',
        score: 0.94,
        project: null,
      }],
    }),
  });
});

afterAll(async () => {
  await server.stop();
});

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${server.baseUrl}${path}`, { headers: { accept: 'application/json' } });
  expect(response.status).toBe(200);
  return response.json() as Promise<T>;
}

test('live backend responses match the unified plugin menu, registry, and vector search schema', async () => {
  const menu = await getJson<{ items: MenuItem[] }>('/api/menu');
  const menuItem = menu.items.find((item) => item.path === '/smoke-orbit');
  expect(menuItem).toMatchObject({
    label: 'Smoke Orbit',
    group: 'tools',
    order: 123,
    source: 'plugin',
  });

  const registry = await getJson<{ plugins: PluginEntry[]; dir: string }>('/api/plugins');
  expect(registry.dir).toContain('.oracle/plugins');
  const plugin = registry.plugins.find((entry) => entry.name === 'smoke-orbit');
  expect(plugin).toMatchObject({
    name: 'smoke-orbit',
    file: '',
    size: 0,
    version: '0.1.0',
    description: 'Smoke fixture plugin',
    menu: { label: 'Smoke Orbit', path: '/smoke-orbit', group: 'tools', order: 123 },
    server: { command: 'bun', args: ['index.ts'], healthPath: '/health', autostart: false },
  });
  expect(Number.isNaN(Date.parse(plugin?.modified ?? ''))).toBe(false);
  expect(plugin?.server && 'env' in plugin.server).toBe(false);

  const vector = await getJson<SearchBody>('/api/search?q=smoke-orbit&mode=hybrid&limit=1');
  expect(vector).toMatchObject({ query: 'smoke-orbit', total: 1, limit: 1, offset: 0 });
  expect(vector.results).toHaveLength(1);
  expect(vector.results[0]).toMatchObject({
    id: 'smoke-vector-doc',
    type: 'learning',
    source_file: 'plugins/smoke-orbit.md',
    source: 'vector',
    concepts: ['plugin', 'smoke'],
    project: null,
  });
});
