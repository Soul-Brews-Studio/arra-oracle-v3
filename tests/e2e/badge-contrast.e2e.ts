import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'node:net';

let frontend: ChildProcessWithoutNullStreams | null = null;
let frontendUrl = '';

test.beforeAll(async () => {
  const port = await freePort();
  frontendUrl = `http://127.0.0.1:${port}`;
  frontend = spawn('bun', ['run', 'dev'], {
    cwd: join(process.cwd(), 'frontend'),
    env: {
      ...process.env,
      FRONTEND_PROXY_TARGET: 'http://127.0.0.1:47778',
      VITE_PORT: String(port),
    },
  });
  await waitForFrontend(frontendUrl);
});

test.afterAll(() => {
  frontend?.kill();
});

for (const theme of ['light', 'dark'] as const) {
  test(`status badges meet 4.5:1 contrast in ${theme} theme`, async ({ page }) => {
    await mockApi(page);
    await page.goto(`${frontendUrl}/status`);
    await setTheme(page, theme);
    await expect(page.getByRole('heading', { name: 'Health overview' })).toBeVisible();
    await expect(page.locator('[data-contrast-badge]')).toHaveCount(6);
    await expectContrast(page, theme, 'status');
  });

  test(`vector export action meets 4.5:1 contrast in ${theme} theme`, async ({ page }) => {
    await mockApi(page);
    await page.goto(`${frontendUrl}/vector/export`);
    await setTheme(page, theme);
    await expect(page.locator('section[aria-labelledby="vector-export-title"]').getByRole('heading', { name: 'Vector export' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
    await expectContrast(page, theme, 'vector export');
  });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port'));
      });
    });
  });
}

async function waitForFrontend(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Frontend did not start at ${url}`);
}

async function mockApi(page: Page): Promise<void> {
  const now = new Date('2026-06-17T00:00:00.000Z').toISOString();
  await fulfill(page, '**/api/menu*', { items: [] });
  await fulfill(page, '**/api/plugins*', { plugins: [], dir: '/tmp/oracle/plugins', count: 0 });
  await fulfill(page, '**/api/v1/metrics*', {
    uptime: 12,
    requestCount: 2,
    avgResponseMs: 4,
    activeConnections: 0,
    lastRestart: now,
    memoryUsage: { rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 },
  });
  await fulfill(page, '**/api/v1/health*', {
    status: 'ok',
    server: 'oracle-test',
    version: 'test',
    port: 47778,
    oracle: 'connected',
    uptimeSeconds: 90,
    dbStatus: 'ok',
    vectorStatus: 'ok',
    pluginStatus: 'ok',
    mcpToolCount: 3,
    pluginCount: 1,
    db: { status: 'ok', path: '/tmp/oracle.sqlite' },
    plugins: { count: 1, status: 'ok', items: [{ name: 'contrast-plugin', status: 'ok' }] },
  });
  await fulfill(page, '**/api/v1/vector/health*', {
    status: 'ok',
    checked_at: now,
    engines: [],
    services: [{ name: 'vector-proxy', type: 'proxy', endpoint: 'http://127.0.0.1:47779', status: 'up', available: true, health: { status: 'ok', checkedAt: now } }],
  });
  await fulfill(page, '**/api/v1/vector/index/models*', {
    models: { qwen3: { collection: 'oracle_knowledge_qwen3', model: 'qwen3', adapter: 'proxy', count: 12 } },
  });
  await fulfill(page, '**/api/v1/vector/export/formats*', {
    formats: [
      { format: 'json', label: 'JSON', mimeType: 'application/json', extension: 'json' },
      { format: 'markdown', label: 'Markdown', mimeType: 'text/markdown', extension: 'md' },
    ],
  });
}

async function fulfill(page: Page, url: string, payload: unknown): Promise<void> {
  await page.route(url, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem('ARRA_FRONTEND_THEME', next);
  }, theme);
}

async function expectContrast(page: Page, theme: string, surface: string): Promise<void> {
  const failures = await page.locator('[data-contrast-badge]').evaluateAll((nodes) => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (value: string): Rgba => {
      const color = value.trim();
      if (color === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      const rgb = color.match(/^rgba?\(([^)]+)\)$/);
      if (rgb) {
        const parts = rgb[1].split(/[,/ ]+/).filter(Boolean).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
      }
      const srgb = color.match(/^color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)$/);
      if (srgb) return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: Number(srgb[4] ?? 1) };
      const oklab = color.match(/^oklab\(([-0-9.]+%?)\s+([-0-9.]+)\s+([-0-9.]+)(?:\s*\/\s*([0-9.]+%?))?\)$/);
      if (oklab) {
        const c = Math.hypot(Number(oklab[2]), Number(oklab[3]));
        const h = Math.atan2(Number(oklab[3]), Number(oklab[2])) * 180 / Math.PI;
        return parse(`oklch(${oklab[1]} ${c} ${h} / ${oklab[4] ?? 1})`);
      }
      const oklch = color.match(/^oklch\(([-0-9.]+%?)\s+([-0-9.]+)\s+([-0-9.]+)(?:deg)?(?:\s*\/\s*([0-9.]+%?))?\)$/);
      if (!oklch) throw new Error(`Unsupported color ${color}`);
      const l = oklch[1].endsWith('%') ? Number(oklch[1].slice(0, -1)) / 100 : Number(oklch[1]);
      const c = Number(oklch[2]);
      const h = Number(oklch[3]) * Math.PI / 180;
      const a = oklch[4]?.endsWith('%') ? Number(oklch[4].slice(0, -1)) / 100 : Number(oklch[4] ?? 1);
      const labA = c * Math.cos(h);
      const labB = c * Math.sin(h);
      const lp = l + 0.3963377774 * labA + 0.2158037573 * labB;
      const mp = l - 0.1055613458 * labA - 0.0638541728 * labB;
      const sp = l - 0.0894841775 * labA - 1.291485548 * labB;
      const ll = lp ** 3;
      const mm = mp ** 3;
      const ss = sp ** 3;
      const gamma = (n: number) => {
        const v = Math.min(1, Math.max(0, n));
        return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * (v ** (1 / 2.4)) - 0.055);
      };
      return {
        r: gamma(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
        g: gamma(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
        b: gamma(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss),
        a,
      };
    };
    const blend = (top: Rgba, bottom: Rgba): Rgba => {
      const a = top.a + bottom.a * (1 - top.a);
      return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
        a,
      };
    };
    const channel = (value: number) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: Rgba) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    const ratio = (left: Rgba, right: Rgba) => {
      const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
      return (high + 0.05) / (low + 0.05);
    };
    return nodes.map((node) => {
      const element = node as HTMLElement;
      let bg: Rgba = { r: 255, g: 255, b: 255, a: 1 };
      const chain: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) chain.unshift(current);
      for (const current of chain) bg = blend(parse(getComputedStyle(current).backgroundColor), bg);
      const fg = blend(parse(getComputedStyle(element).color), bg);
      const contrast = ratio(fg, bg);
      return { text: element.innerText.replace(/\s+/g, ' ').trim(), contrast: Number(contrast.toFixed(2)) };
    }).filter((item) => item.text && item.contrast < 4.5);
  });
  expect(failures, `${surface} ${theme} contrast failures`).toEqual([]);
}
