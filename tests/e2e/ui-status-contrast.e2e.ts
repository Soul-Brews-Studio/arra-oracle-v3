import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { contrastFailures } from './contrast-helpers';

const uiPort = 4310;
const uiBase = `http://127.0.0.1:${uiPort}`;
const longCollection = 'bge-m3-extremely-long-vector-collection-name-that-used-to-force-export-overflow';
let vite: ChildProcessWithoutNullStreams | null = null;

const pages = [
  ['/menu', 'Menu catalog'],
  ['/plugins', 'Unified plugin surfaces'],
  ['/status', 'Health overview'],
  ['/vector', 'Vector dashboard'],
  ['/export', 'Export app'],
  ['/vector/export', 'Vector export'],
  ['/search?q=status', 'Search results'],
  ['/mcp', 'Tool browser'],
  ['/settings', 'Runtime configuration'],
] as const;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  vite = spawn('bun', ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: `${process.cwd()}/frontend`,
    env: { ...process.env, VITE_PORT: String(uiPort) },
    stdio: 'pipe',
  });
  await waitForUi();
});

test.afterAll(() => {
  vite?.kill('SIGTERM');
  vite = null;
});

async function waitForUi(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(uiBase);
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error('frontend dev server did not become ready');
}

const menuItems = [
  { label: 'Menu', path: '/menu', group: 'main', order: 1 },
  { label: 'Status', path: '/status', group: 'main', order: 2 },
  { label: 'Export', path: '/vector/export', group: 'tools', order: 3 },
];
const plugins = [{ name: 'muninn-search', version: '1.0.0', status: 'ok', enabled: true, description: 'Semantic memory search.', surfaces: ['mcp'], menu: { label: 'Search', path: '/search' }, mcpTools: [{ name: 'muninn_search' }] }];
const metrics = { uptime: 1234, requestCount: 42, avgResponseMs: 12, activeConnections: 1, lastRestart: new Date().toISOString(), memoryUsage: { rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 } };
const vectorModels = { models: { docs: { collection: longCollection, model: 'bge-m3', adapter: 'lancedb', count: 123456 } } };
const vectorHealth = { status: 'ok', checked_at: new Date().toISOString(), engines: [{ key: 'docs', collection: longCollection, model: 'bge-m3', ok: true }], providers: [{ type: 'ollama', status: 'ok', available: true, configured: true }], services: [{ name: 'VECTOR_URL', type: 'proxy', endpoint: 'http://127.0.0.1:47779/vector', available: true, health: { status: 'ok' } }], storage: [{ key: 'docs', status: 'ok', adapter: 'lancedb' }], freshness: { status: 'fresh', checkedAt: new Date().toISOString() } };
const vectorConfig = { source: 'defaults', config: { collections: { docs: { key: 'docs', collection: longCollection, model: 'bge-m3', provider: 'ollama', adapter: 'lancedb', enabled: true, primary: true } } }, doc_counts: { docs: 123456 }, health: { docs: { ok: true, status: 'ok', collection: longCollection, adapter: 'lancedb', model: 'bge-m3', enabled: true } } };
const settings = { storage: { activeBackend: 'sqlite', configuredBackend: 'sqlite', defaultBackend: 'sqlite', dbPath: '/tmp/oracle.db', dataDir: '/tmp', repoRoot: '/repo' }, embedder: { source: 'defaults', backend: 'ollama', model: 'bge-m3', url: 'http://127.0.0.1:11434', dimensions: 1024, embeddingEndpoint: '/api/embed', collections: [vectorConfig.config.collections.docs] }, migrations: { status: 'current', tablePresent: true, appliedCount: 3, availableCount: 3, pendingCount: 0, latestKnown: '0003', latestAppliedAt: new Date().toISOString() } };

function apiBody(path: string, searchParams: URLSearchParams): unknown {
  if (path === '/api/health') return { status: 'ok' };
  if (path === '/api/stats') return { total: 12, total_docs: 12, vector: { enabled: true, count: 4 } };
  if (path === '/api/menu') return { items: menuItems };
  if (path === '/api/menu/search') return { data: menuItems, q: searchParams.get('q') ?? '', total: menuItems.length };
  if (path === '/api/plugins' || path === '/api/v1/plugins') return { dir: '/tmp/plugins', count: plugins.length, plugins };
  if (path === '/api/v1/metrics') return metrics;
  if (path === '/api/v1/health') return { status: 'ok', server: 'arra-oracle-v3', version: 'test', port: 47778, oracle: 'connected', uptimeSeconds: 1234, dbStatus: 'connected', vectorStatus: 'ok', pluginStatus: 'ok', mcpToolCount: 7, pluginCount: 2, db: { status: 'ok', path: '/tmp/oracle.db' }, plugins: { count: 2, status: 'ok', items: [{ name: 'muninn_search', status: 'ok' }, { name: 'vector_export', status: 'ok' }] } };
  if (path === '/api/v1/vector/health' || path === '/api/vector/health') return vectorHealth;
  if (path === '/api/v1/vector/index/models' || path === '/api/vector/index/models') return vectorModels;
  if (path === '/api/v1/vector/index/status') return { jobId: 'idle', model: 'bge-m3', status: 'idle', current: 0, total: 0, startedAt: 0, docsPerSec: 0, eta: 0 };
  if (path === '/api/v1/vector/export/formats') return { formats: [{ format: 'json', label: 'JSON', mimeType: 'application/json', extension: 'json' }, { format: 'jsonl', label: 'JSONL', mimeType: 'application/x-ndjson', extension: 'jsonl' }] };
  if (path === '/api/v1/vector/config') return vectorConfig;
  if (path === '/api/v1/vector/providers') return { providers: [{ type: 'ollama', available: true, configured: true, status: 'ok', models: ['bge-m3'] }] };
  if (path === '/api/v1/vector/services') return { services: vectorHealth.services };
  if (path === '/api/search') return { results: [], total: 0, query: searchParams.get('q') ?? '' };
  if (path === '/api/mcp/tools') return { total: 2, tools: [{ name: 'muninn_search', description: 'Search memory.', group: 'memory', mode: 'read', source: 'core' }, { name: 'plugin_sync', description: 'Sync plugin surfaces.', group: 'plugins', mode: 'write', source: 'plugin', plugin: 'muninn-search' }] };
  if (path === '/api/settings/system') return settings;
  if (path === '/api/v1/export/oracle-v2/collections' || path === '/api/v1/export/app/collections') return { collections: [{ id: longCollection, label: longCollection, count: 123456 }] };
  return {};
}

async function openUi(page: Page, path: string, theme: 'light' | 'dark', width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((value) => {
    localStorage.setItem('ARRA_FRONTEND_THEME', value);
    localStorage.setItem('arra.vector.setup.dismissed', '1');
  }, theme);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(apiBody(url.pathname, url.searchParams)) });
  });
  await page.goto(`${uiBase}${path}`, { waitUntil: 'domcontentloaded' });
}

for (const theme of ['light', 'dark'] as const) {
  for (const [path, heading] of pages) {
    test(`${path} has no text contrast failures in ${theme} mode`, async ({ page }) => {
      await openUi(page, path, theme);
      await expect(page.getByText(heading).first()).toBeVisible();
      const failures = await contrastFailures(page);
      expect(failures, JSON.stringify(failures.slice(0, 8), null, 2)).toEqual([]);
    });
  }
}

for (const width of [1280, 1440]) {
  test(`export pages do not horizontally overflow at ${width}px`, async ({ page }) => {
    for (const path of ['/vector/export', '/export']) {
      await openUi(page, path, 'light', width);
      await expect(page.getByText(path === '/export' ? 'Export app' : 'Vector export').first()).toBeVisible();
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });
}
