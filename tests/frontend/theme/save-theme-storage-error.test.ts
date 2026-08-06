import { describe, expect, test } from 'bun:test';
import { saveTheme } from '../../../frontend/src/theme';
import { installBrowserLocation } from '../_render';

describe('saveTheme storage errors', () => {
  test('still applies the theme when localStorage is blocked', () => {
    const restore = installBrowserLocation('/menu');
    try {
      Object.defineProperty(window.localStorage, 'setItem', { value: () => { throw new Error('blocked'); } });
      expect(() => saveTheme('dark')).not.toThrow();
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      restore();
    }
  });
});
