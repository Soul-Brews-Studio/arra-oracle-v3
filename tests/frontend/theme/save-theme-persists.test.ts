import { describe, expect, test } from 'bun:test';
import { saveTheme, THEME_KEY } from '../../../frontend/src/theme';
import { installBrowserLocation } from '../_render';

describe('saveTheme persistence', () => {
  test('stores the selected theme and applies document metadata', () => {
    const restore = installBrowserLocation('/menu');
    try {
      saveTheme('dark');
      expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    } finally {
      restore();
    }
  });
});
