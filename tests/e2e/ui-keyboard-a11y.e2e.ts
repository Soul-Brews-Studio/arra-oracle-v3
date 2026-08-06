import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const uiPort = 4312;
const uiBase = `http://127.0.0.1:${uiPort}`;
let vite: ChildProcessWithoutNullStreams | null = null;

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
  { label: 'Plugins', path: '/plugins', group: 'main', order: 2 },
  { label: 'Status', path: '/status', group: 'main', order: 3 },
];
const plugins = [{ name: 'muninn-search', version: '1.0.0', status: 'ok', enabled: true, surfaces: ['mcp'], description: 'Semantic memory search.', mcpTools: [{ name: 'muninn_search' }] }];
const metrics = { uptime: 1234, requestCount: 42, avgResponseMs: 12, activeConnections: 1, lastRestart: new Date().toISOString(), memoryUsage: { rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 } };
const vectorHealth = { status: 'ok', checked_at: new Date().toISOString(), engines: [], providers: [], services: [], storage: [], freshness: { status: 'fresh', checkedAt: new Date().toISOString() } };
const settings = { storage: { activeBackend: 'sqlite', configuredBackend: 'sqlite', defaultBackend: 'sqlite', dbPath: '/tmp/oracle.db', dataDir: '/tmp', repoRoot: '/repo' }, embedder: { source: 'defaults', backend: 'ollama', model: 'bge-m3', url: 'http://127.0.0.1:11434', dimensions: 1024, embeddingEndpoint: '/api/embed', collections: [] }, migrations: { status: 'current', tablePresent: true, appliedCount: 3, availableCount: 3, pendingCount: 0, latestKnown: '0003', latestAppliedAt: new Date().toISOString() } };

function apiBody(path: string, searchParams: URLSearchParams): unknown {
  if (path === '/api/health') return { status: 'ok' };
  if (path === '/api/stats') return { total: 12, total_docs: 12, vector: { enabled: true, count: 4 } };
  if (path === '/api/menu') return { items: menuItems };
  if (path === '/api/menu/search') return { data: menuItems.filter((item) => item.label.toLowerCase().includes((searchParams.get('q') ?? '').toLowerCase())), q: searchParams.get('q') ?? '', total: menuItems.length };
  if (path === '/api/plugins' || path === '/api/v1/plugins') return { dir: '/tmp/plugins', count: plugins.length, plugins };
  if (path === '/api/v1/metrics') return metrics;
  if (path === '/api/v1/health') return { status: 'ok', server: 'arra-oracle-v3', version: 'test', port: 47778, oracle: 'connected', uptimeSeconds: 1234, dbStatus: 'connected', vectorStatus: 'ok', pluginStatus: 'ok', mcpToolCount: 7, pluginCount: 1, db: { status: 'ok', path: '/tmp/oracle.db' }, plugins: { count: 1, status: 'ok', items: [{ name: 'muninn_search', status: 'ok' }] } };
  if (path === '/api/v1/vector/health' || path === '/api/vector/health') return vectorHealth;
  if (path === '/api/v1/vector/index/models' || path === '/api/vector/index/models') return { models: {} };
  if (path === '/api/v1/vector/index/status') return { jobId: 'idle', model: 'bge-m3', status: 'idle', current: 0, total: 0, startedAt: 0, docsPerSec: 0, eta: 0 };
  if (path === '/api/v1/vector/config') return { source: 'defaults', config: { collections: {} }, doc_counts: {}, health: {} };
  if (path === '/api/v1/vector/providers') return { providers: [] };
  if (path === '/api/v1/vector/services') return { services: [] };
  if (path === '/api/search') return { results: [], total: 0, query: searchParams.get('q') ?? '' };
  if (path === '/api/mcp/tools') return { total: 1, tools: [{ name: 'muninn_search', description: 'Search memory.', group: 'memory', mode: 'read', source: 'core' }] };
  if (path === '/api/settings/system') return settings;
  if (path === '/api/v1/export/app/collections' || path === '/api/v1/export/oracle-v2/collections') return { collections: [{ id: 'oracle_documents', label: 'oracle_documents', count: 12 }] };
  return {};
}

async function openUi(page: Page, path = '/menu', theme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
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

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement).catch(() => false);
}

async function tabUntil(page: Page, locator: Locator, maxTabs = 30): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press('Tab');
    if (await isFocused(locator)) return;
  }
  const active = await page.evaluate(() => `${document.activeElement?.tagName ?? 'none'}:${document.activeElement?.textContent?.trim().slice(0, 80) ?? ''}`);
  throw new Error(`Could not tab to expected control; active=${active}`);
}

async function expectVisibleFocus(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const style = await locator.evaluate((element) => {
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { outlineStyle: computed.outlineStyle, outlineWidth: computed.outlineWidth, boxShadow: computed.boxShadow, width: rect.width, height: rect.height };
  });
  const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
  const shadow = style.boxShadow !== 'none';
  expect(style.width).toBeGreaterThan(0);
  expect(style.height).toBeGreaterThan(0);
  expect(outline || shadow, JSON.stringify(style)).toBe(true);
}

test('skip link is the first keyboard stop and can move focus to main content', async ({ page }) => {
  await openUi(page, '/menu', 'light');
  await expect(page.getByRole('heading', { name: 'Menu catalog' })).toBeVisible();
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await page.keyboard.press('Tab');
  await expectVisibleFocus(skip);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) {
  test(`keyboard focus is visible on shell controls in ${theme} mode`, async ({ page }) => {
    await openUi(page, '/menu', theme);
    await expect(page.getByRole('heading', { name: 'Menu catalog' })).toBeVisible();
    const controlsBeforeToggle = [
      page.getByRole('link', { name: 'Arra Oracle control surface home' }),
      page.getByRole('link', { name: /Menu: Navigation rows/ }),
      page.getByRole('link', { name: /Plugins: Registered plugins/ }),
      page.getByRole('button', { name: 'Open command palette' }),
      page.getByRole('searchbox', { name: 'Search all surfaces' }),
    ];
    for (const control of controlsBeforeToggle) {
      await tabUntil(page, control);
      await expectVisibleFocus(control);
    }
    const toggle = page.getByRole('button', { name: 'Dark mode' });
    await tabUntil(page, toggle);
    await expectVisibleFocus(toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', theme === 'dark' ? 'false' : 'true');
    const refresh = page.getByRole('button', { name: 'Refresh data' });
    await tabUntil(page, refresh);
    await expectVisibleFocus(refresh);
  });
}

test('aria labels and keyboard route changes remain intact', async ({ page }) => {
  await openUi(page, '/menu', 'light');
  await expect(page.getByRole('navigation', { name: 'Frontend sections' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filter menu group' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filter menu source' })).toBeVisible();

  const pluginsLink = page.getByRole('link', { name: /Plugins: Registered plugins/ });
  await tabUntil(page, pluginsLink);
  await expectVisibleFocus(pluginsLink);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/plugins$/);
  await expect(page.locator('#main-content')).toBeFocused();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await expectVisibleFocus(page.getByRole('combobox', { name: 'Search command palette' }));

  await openUi(page, '/search', 'light');
  const search = page.getByRole('searchbox', { name: 'Menu search query' });
  const menuSearchForm = page.getByRole('search', { name: 'Menu search form' });
  await expect(menuSearchForm).toBeVisible();
  await search.fill('status');
  await menuSearchForm.getByRole('button', { name: 'Search' }).press('Enter');
  await expect(page.getByText('1 menu result for “status”.')).toBeVisible();
});

test('command palette and global search expose keyboard-operable result lists', async ({ page }) => {
  await openUi(page, '/menu', 'light');

  const paletteButton = page.getByRole('button', { name: 'Open command palette' });
  await tabUntil(page, paletteButton);
  await expectVisibleFocus(paletteButton);
  await paletteButton.press('Enter');
  const commandInput = page.getByRole('combobox', { name: 'Search command palette' });
  await expectVisibleFocus(commandInput);
  await expect(commandInput).toHaveAttribute('aria-controls', 'command-palette-options');
  await commandInput.fill('plugins');
  const pluginOption = page.getByRole('option', { name: /Plugins/ });
  await expect(pluginOption).toBeVisible();
  await expect(pluginOption).toHaveAttribute('aria-selected', 'true');
  await commandInput.press('Enter');
  await expect(page).toHaveURL(/\/plugins$/);
  await expect(page.locator('#main-content')).toBeFocused();

  await openUi(page, '/menu', 'light');
  const globalSearch = page.getByRole('searchbox', { name: 'Search all surfaces' });
  await tabUntil(page, globalSearch);
  await expectVisibleFocus(globalSearch);
  await expect(globalSearch).toHaveAttribute('aria-controls', 'global-search-results');
  await globalSearch.fill('muninn');
  await page.getByLabel('Global frontend search').getByRole('button', { name: 'Search' }).press('Enter');
  const results = page.getByRole('region', { name: 'Global search results' });
  await expect(results).toContainText('muninn-search');
  const firstResult = results.getByRole('link').first();
  await tabUntil(page, firstResult);
  await expectVisibleFocus(firstResult);
});
