import { expect, test } from '@playwright/test';

const frontendURL = process.env.PLAYWRIGHT_FRONTEND_URL ?? 'http://127.0.0.1:3310';
const frontendHost = new URL(frontendURL).host;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((host) => {
    window.localStorage.setItem('arra.vector.setup.dismissed', '1');
    window.localStorage.setItem('arra-oracle-setup-complete', '1');
    window.localStorage.setItem('oracle.host', host);
  }, frontendHost);
});

test('large nav scrolls inside rounded sidebar without spilling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto('/menu');
  await expect(page.getByLabel('Arra Oracle control surface home')).toBeVisible();

  const aside = page.getByLabel('Application navigation');
  const nav = page.getByLabel('Frontend sections');
  await expect(nav).toBeVisible();

  const bounds = await page.evaluate(() => {
    const asideEl = document.querySelector('[aria-label="Application navigation"]')!;
    const navEl = document.querySelector('[aria-label="Frontend sections"]')!;
    const asideBox = asideEl.getBoundingClientRect();
    const navBox = navEl.getBoundingClientRect();
    return {
      asideBottom: asideBox.bottom,
      navBottom: navBox.bottom,
      navScrollHeight: navEl.scrollHeight,
      navClientHeight: navEl.clientHeight,
    };
  });

  await expect(aside).toHaveClass(/lg:h-\[calc\(100vh-2rem\)\]/);
  await expect(nav).toHaveClass(/lg:min-h-0/);
  await expect(nav).toHaveClass(/lg:overflow-y-auto/);
  expect(bounds.navBottom).toBeLessThanOrEqual(bounds.asideBottom + 1);
  expect(bounds.navScrollHeight).toBeGreaterThan(bounds.navClientHeight);
});
