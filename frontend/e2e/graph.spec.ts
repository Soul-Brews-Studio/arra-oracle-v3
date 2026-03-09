import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_URL || 'http://localhost:47778';

test.describe('Graph Page', () => {
  test('loads and displays nodes', async ({ page }) => {
    await page.goto(`${BASE_URL}/graph`);
    await page.waitForLoadState('networkidle');

    const heading = page.locator('h1, h2, [class*="title"]').first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const graphContainer = page.locator('canvas, [class*="graph"], [class*="Graph"]').first();
    await expect(graphContainer).toBeVisible({ timeout: 10000 });

    const statsText = await page.textContent('body');
    expect(statsText).toMatch(/\d+\s*nodes/i);
    expect(statsText).toMatch(/\d+\s*links/i);
  });

  test('3D graph canvas renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(`${BASE_URL}/graph`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const criticalErrors = errors.filter(e =>
      e.includes('Cannot read') ||
      e.includes('undefined') ||
      e.includes('WebGL') ||
      e.includes('three')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('API returns graph data', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/graph`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('nodes');
    expect(data).toHaveProperty('links');
    expect(Array.isArray(data.nodes)).toBeTruthy();
    expect(Array.isArray(data.links)).toBeTruthy();
    expect(data.nodes.length).toBeGreaterThan(0);
  });
});

test.describe('Overview Page', () => {
  test('shows correct document counts', async ({ page, request }) => {
    const statsResponse = await request.get(`${BASE_URL}/api/stats`);
    const stats = await statsResponse.json();

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    const formattedTotal = stats.total.toLocaleString();
    expect(bodyText).toContain(formattedTotal);
  });
});

test.describe('Search', () => {
  test('returns results for query', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/search?q=nothing+deleted&limit=5`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.results.length).toBeGreaterThan(0);
  });
});
