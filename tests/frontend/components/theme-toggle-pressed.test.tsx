import { describe, expect, test } from 'bun:test';
import { ThemeToggle } from '../../../frontend/src/components/ThemeToggle';
import { THEME_KEY } from '../../../frontend/src/theme';
import { htmlFor, installBrowserLocation } from '../_render';

describe('ThemeToggle pressed state', () => {
  test('marks dark mode as pressed and names the next theme for assistive tech', () => {
    const restore = installBrowserLocation('/menu');
    try {
      window.localStorage.setItem(THEME_KEY, 'dark');
      const html = htmlFor(<ThemeToggle />);
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('aria-label="Switch to light theme"');
      expect(html).toContain('data-theme-toggle="dark"');
      expect(html).toContain('Current theme is dark.');
    } finally {
      restore();
    }
  });
});
