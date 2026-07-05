import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = 'http://localhost:3000';
const OUT = join(import.meta.dirname, 'screenshots');
const findings: Array<{ page: string; element: string; action: string; result: string; screenshot: string }> = [];

const ROUTES = [
  { path: '/', name: 'menu' },
  { path: '/plugins', name: 'plugins' },
  { path: '/status', name: 'status' },
  { path: '/search', name: 'search' },
  { path: '/feed', name: 'feed' },
  { path: '/forum', name: 'forum' },
  { path: '/traces', name: 'activity' },
  { path: '/vector', name: 'vector-dashboard' },
  { path: '/vector/documents', name: 'vector-documents' },
  { path: '/vector/first-run', name: 'vector-first-run' },
  { path: '/vector/index', name: 'vector-index' },
  { path: '/vector/search', name: 'vector-search' },
  { path: '/vector/settings', name: 'vector-settings' },
  { path: '/vector/export', name: 'vector-export' },
  { path: '/learn', name: 'learn' },
  { path: '/memory', name: 'memory' },
  { path: '/metrics', name: 'metrics' },
  { path: '/mcp', name: 'mcp' },
  { path: '/storage', name: 'storage' },
  { path: '/settings', name: 'settings' },
  { path: '/export', name: 'export-app' },
];

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
}

test.describe('UI Audit Capture', () => {
  test.setTimeout(120_000);

  for (const route of ROUTES) {
    test(`page: ${route.name} (${route.path})`, async ({ page }) => {
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1500);

      const baseFile = `${route.name}_baseline.png`;
      await page.screenshot({ path: join(OUT, baseFile), fullPage: true });
      findings.push({ page: route.name, element: 'page', action: 'load', result: 'ok', screenshot: baseFile });

      const buttons = await page.locator('button:visible, a[role="button"]:visible, [role="tab"]:visible').all();
      for (let i = 0; i < Math.min(buttons.length, 20); i++) {
        const btn = buttons[i];
        const label = await btn.textContent().catch(() => '') || '';
        const ariaLabel = await btn.getAttribute('aria-label').catch(() => '') || '';
        const name = (label || ariaLabel || `button-${i}`).trim().slice(0, 40);
        const fileName = `${route.name}_click_${slug(name)}.png`;

        try {
          const box = await btn.boundingBox();
          if (!box || box.width < 2 || box.height < 2) continue;

          await btn.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
          await page.screenshot({ path: join(OUT, fileName), fullPage: true });
          findings.push({ page: route.name, element: name, action: 'click', result: 'ok', screenshot: fileName });
        } catch (e) {
          findings.push({ page: route.name, element: name, action: 'click', result: `error: ${String(e).slice(0, 80)}`, screenshot: '' });
        }
      }

      const selects = await page.locator('select:visible').all();
      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        const name = await sel.getAttribute('aria-label').catch(() => '') || `select-${i}`;
        const fileName = `${route.name}_select_${slug(name)}.png`;
        try {
          await sel.click({ timeout: 2000 });
          await page.waitForTimeout(500);
          await page.screenshot({ path: join(OUT, fileName), fullPage: true });
          findings.push({ page: route.name, element: name, action: 'open-select', result: 'ok', screenshot: fileName });
        } catch {
          findings.push({ page: route.name, element: name, action: 'open-select', result: 'error', screenshot: '' });
        }
      }

      const inputs = await page.locator('input[type="text"]:visible, input[type="search"]:visible, textarea:visible').all();
      for (let i = 0; i < inputs.length; i++) {
        const inp = inputs[i];
        const name = await inp.getAttribute('placeholder').catch(() => '') || `input-${i}`;
        const fileName = `${route.name}_input_${slug(name)}.png`;
        try {
          await inp.click({ timeout: 2000 });
          await inp.fill('test query');
          await page.waitForTimeout(500);
          await page.screenshot({ path: join(OUT, fileName), fullPage: true });
          await inp.fill('');
          findings.push({ page: route.name, element: name, action: 'type', result: 'ok', screenshot: fileName });
        } catch {
          findings.push({ page: route.name, element: name, action: 'type', result: 'error', screenshot: '' });
        }
      }
    });
  }

  test.afterAll(() => {
    mkdirSync(OUT, { recursive: true });
    const md = ['# UI Audit Capture Report\n', `**Date**: ${new Date().toISOString()}\n`, '| Page | Element | Action | Result | Screenshot |', '|------|---------|--------|--------|------------|'];
    for (const f of findings) {
      const img = f.screenshot ? `![${f.element}](screenshots/${f.screenshot})` : '—';
      md.push(`| ${f.page} | ${f.element} | ${f.action} | ${f.result} | ${img} |`);
    }
    md.push(`\n**Total interactions**: ${findings.length}`);
    writeFileSync(join(OUT, '..', 'audit-report.md'), md.join('\n'));
  });
});
