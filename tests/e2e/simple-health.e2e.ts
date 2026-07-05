import { expect, test, type Page, type TestInfo } from '@playwright/test';

const healthPath = '**/api/health';

type Scenario = {
  name: string;
  headline: string;
  cta: string;
  dotColor: string;
  health: Record<string, unknown>;
};

const baseHealth = {
  server: 'arra-oracle-v3',
  version: 'e2e',
  uptimeSeconds: 12,
  dbStatus: 'connected',
  db: { status: 'connected', path: '/tmp/oracle.db' },
  pluginStatus: 'ok',
  plugins: { status: 'ok', count: 0, items: [] },
  vectorStatus: 'ok',
  vectorAvailable: true,
  vector: { status: 'ok', engines: [], checked_at: '2026-06-17T00:00:00.000Z' },
};

const scenarios: Scenario[] = [
  {
    name: 'healthy',
    headline: 'Awake and remembering',
    cta: 'Ask or add a memory.',
    dotColor: 'oklch(0.765 0.177 163.223)',
    health: { ...baseHealth, status: 'ok' },
  },
  {
    name: 'starting',
    headline: 'Starting up…',
    cta: 'Wait briefly, then retry if it keeps spinning.',
    dotColor: 'oklch(0.707 0.165 254.624)',
    health: { ...baseHealth, status: 'starting' },
  },
  {
    name: 'degraded-fts',
    headline: 'Running, but search is limited',
    cta: 'You can still save memories; rebuild or retry indexing for better search.',
    dotColor: 'oklch(0.828 0.189 84.429)',
    health: { ...baseHealth, status: 'ok', vectorAvailable: false, vectorStatus: 'degraded' },
  },
  {
    name: 'degraded-db',
    headline: 'Running, but memory storage needs help',
    cta: 'Check ORACLE_DATA_DIR and database permissions, then retry.',
    dotColor: 'oklch(0.637 0.237 25.331)',
    health: { ...baseHealth, status: 'degraded', dbStatus: 'error', db: { status: 'error', path: '/tmp/oracle.db' } },
  },
  {
    name: 'degraded-plugin',
    headline: 'Running, but a plugin needs attention',
    cta: 'Open plugin settings or disable the failing plugin.',
    dotColor: 'oklch(0.828 0.189 84.429)',
    health: { ...baseHealth, status: 'ok', pluginStatus: 'degraded', plugins: { status: 'degraded', count: 1, items: [] } },
  },
  {
    name: 'down',
    headline: "Can't reach your Oracle",
    cta: 'Retry',
    dotColor: 'oklch(0.637 0.237 25.331)',
    health: { ...baseHealth, status: 'down' },
  },
];

async function mockHealth(page: Page, scenario: Scenario) {
  await page.route(healthPath, async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scenario.health),
    });
  });
}

async function attachScreenshot(page: Page, testInfo: TestInfo, state: string) {
  const path = testInfo.outputPath(`simple-health-${state}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`simple-health-${state}`, { path, contentType: 'image/png' });
}

test.describe('Simple Mode health hero', () => {
  for (const scenario of scenarios) {
    test(`${scenario.name} state shows color, headline, CTA, and screenshot`, async ({ page }, testInfo) => {
      await mockHealth(page, scenario);
      await page.goto('/simple');

      const hero = page.locator('[data-health-state]');
      await expect(hero).toHaveAttribute('data-health-state', scenario.name);
      await expect(page.getByRole('heading', { name: scenario.headline })).toBeVisible();
      await expect(page.getByRole('button', { name: scenario.cta })).toBeVisible();
      if (scenario.name === 'down') {
        await expect(page.getByText('Docker: docker compose up -d')).toBeVisible();
        await expect(page.getByText('Bun: bun run server')).toBeVisible();
      }
      await expect(page.getByTestId('simple-health-dot')).toHaveCSS('background-color', scenario.dotColor);
      await expect(page.getByText(/checked \d+s ago/)).toBeVisible();

      await attachScreenshot(page, testInfo, scenario.name);
    });
  }
});
