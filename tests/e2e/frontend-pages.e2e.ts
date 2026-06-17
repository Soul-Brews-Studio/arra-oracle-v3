import { expect, test, type Page } from '@playwright/test';

const frontendURL = process.env.PLAYWRIGHT_FRONTEND_URL ?? 'http://127.0.0.1:3310';
const frontendHost = new URL(frontendURL).host;

async function openFrontendPage(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((host) => {
    window.localStorage.setItem('arra.vector.setup.dismissed', '1');
    window.localStorage.setItem('arra-oracle-setup-complete', '1');
    window.localStorage.setItem('oracle.host', host);
  }, frontendHost);
});

test.describe('Frontend pages render and interact through the Vite proxy', () => {
  test('renders the primary dashboard pages', async ({ page }) => {
    await openFrontendPage(page, '/menu', 'Menu catalog');
    await openFrontendPage(page, '/plugins', 'Unified plugin surfaces');
    await openFrontendPage(page, '/vector', 'Vector dashboard');
    await openFrontendPage(page, '/mcp', 'Tool browser');
  });

  test('toggles the shell theme from a rendered menu page', async ({ page }) => {
    await openFrontendPage(page, '/menu', 'Menu catalog');

    const toggle = page.getByRole('button', { name: 'Dark mode' });
    const previous = await toggle.getAttribute('aria-pressed');
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', previous === 'true' ? 'false' : 'true');
    await expect(page.getByRole('heading', { name: 'Menu catalog' }).first()).toBeVisible();
  });

  test('submits menu search and navigates with the command palette', async ({ page }) => {
    await openFrontendPage(page, '/search', 'Full-text menu search');
    await page.getByLabel('Menu search query').fill('vector');
    await page.getByLabel('Menu search form').getByRole('button', { name: 'Search' }).click();

    await expect(page).toHaveURL(/\/search\?q=vector$/);
    await expect(page.getByRole('region', { name: 'Menu search results card' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible();

    await page.getByLabel('Open command palette').click();
    await page.getByLabel('Search command palette').fill('mcp');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/mcp$/);
    await expect(page.getByRole('heading', { name: 'Tool browser' })).toBeVisible();
  });
});
