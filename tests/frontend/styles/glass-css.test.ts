import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const css = readFileSync('frontend/src/styles.css', 'utf8');

describe('glass CSS foundation', () => {
  test('defines dark glass tokens and utility classes', () => {
    expect(css).toContain('--glass-bg: oklch(0.16 0.02 265 / 0.35)');
    expect(css).toContain('--glass-border: oklch(1 0 0 / 0.08)');
    expect(css).toContain('--glass-shadow: 0 8px 32px oklch(0 0 0 / 0.4)');
    expect(css).toContain('--glass-blur: 24px');
    expect(css).toContain('.glass {');
    expect(css).toContain('backdrop-filter: blur(var(--glass-blur));');
    expect(css).toContain('-webkit-backdrop-filter: blur(var(--glass-blur));');
    expect(css).toContain('.glass-hover:hover');
  });
});
