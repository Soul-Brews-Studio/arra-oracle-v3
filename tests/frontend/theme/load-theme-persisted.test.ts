import { describe, expect, test } from 'bun:test';
import { loadTheme, THEME_KEY } from '../../../frontend/src/theme';
import { installBrowserLocation } from '../_render';

describe('loadTheme persistence', () => {
  test('loads a saved preference and applies it on startup', () => {
    const restore = installBrowserLocation('/menu');
    try {
      window.localStorage.setItem(THEME_KEY, 'dark');
      expect(loadTheme()).toBe('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    } finally {
      restore();
    }
  });
});
