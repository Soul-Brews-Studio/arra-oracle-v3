import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type Failure = { path: string; theme: string; text: string; ratio: number; color: string; background: string };
const PAGES = ['/menu', '/plugins', '/status', '/vector', '/export', '/search', '/mcp', '/settings'];
mkdirSync('test-results/contrast', { recursive: true });

test.describe('frontend WCAG AA contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const path of PAGES) {
      test(`${theme} ${path} text contrast is at least 4.5:1`, async ({ page }) => {
        await setTheme(page, theme);
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.locator('body').waitFor({ state: 'visible' });
        await page.waitForTimeout(250);
        await page.screenshot({ path: `test-results/contrast/${theme}-${slug(path)}.png`, fullPage: true });
        const failures = await page.evaluate(({ path, theme }) => {
          type Rgba = { r: number; g: number; b: number; a: number };
          const text = (el: HTMLElement) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          const direct = (el: HTMLElement) => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim());
          const parse = (value: string): Rgba | null => {
            const ctx = document.createElement('canvas').getContext('2d');
            if (!ctx) return null;
            ctx.fillStyle = '#000';
            ctx.fillStyle = value;
            const normalized = ctx.fillStyle;
            const hex = normalized.match(/^#([\da-f]{6}|[\da-f]{8})$/i)?.[1];
            if (hex) {
              const v = Number.parseInt(hex, 16);
              return hex.length === 8 ? { r: v >> 24 & 255, g: v >> 16 & 255, b: v >> 8 & 255, a: (v & 255) / 255 } : { r: v >> 16 & 255, g: v >> 8 & 255, b: v & 255, a: 1 };
            }
            const rgba = normalized.match(/^rgba?\(([^)]+)\)$/i)?.[1];
            if (!rgba) return null;
            const p = rgba.split(',').map((part) => Number.parseFloat(part.trim()));
            return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
          };
          const over = (top: Rgba, bottom: Rgba): Rgba => {
            const a = top.a + bottom.a * (1 - top.a);
            return a ? { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a } : { r: 0, g: 0, b: 0, a: 0 };
          };
          const bgFor = (el: HTMLElement): Rgba => {
            let bg: Rgba = { r: 0, g: 0, b: 0, a: 0 };
            for (let n: HTMLElement | null = el; n; n = n.parentElement) {
              const c = parse(getComputedStyle(n).backgroundColor);
              if (!c || c.a === 0) continue;
              bg = over(bg, c);
              if (bg.a >= 1) break;
            }
            return bg.a ? bg : { r: 255, g: 255, b: 255, a: 1 };
          };
          const lum = (c: Rgba) => {
            const ch = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
          };
          const ratio = (a: Rgba, b: Rgba) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
          const rgbaText = (c: Rgba) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 100) / 100})`;
          const failures: Failure[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const el = node as HTMLElement;
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 || el.getClientRects().length === 0) continue;
            if (!text(el) || !direct(el)) continue;
            const fg = parse(style.color);
            const bg = bgFor(el);
            if (!fg) continue;
            const value = ratio(over(fg, bg), bg);
            if (value < 4.5) failures.push({ path, theme, text: text(el).slice(0, 80), ratio: Math.round(value * 100) / 100, color: style.color, background: rgbaText(bg) });
          }
          return failures;
        }, { path, theme });
        expect(formatFailures(failures)).toEqual('');
      });
    }
  }
});

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((mode) => {
    localStorage.setItem('ARRA_FRONTEND_THEME', mode);
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.classList.toggle('light', mode === 'light');
  }, theme);
}

function formatFailures(failures: Failure[]): string {
  return failures.map((f) => `${f.theme} ${f.path} ${f.ratio}:1 ${JSON.stringify(f.text)} ${f.color} on ${f.background}`).join('\n');
}

function slug(path: string): string {
  return path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'home';
}
