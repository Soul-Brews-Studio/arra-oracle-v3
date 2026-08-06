import { describe, expect, test } from 'bun:test';
import { readStoredTheme } from '../../../frontend/src/theme';

function withThrowingStorage() {
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: { getItem() { throw new Error('blocked'); } },
    matchMedia: () => ({ matches: false }),
  } as unknown as Window & typeof globalThis;
  return () => {
    globalThis.window = previousWindow;
  };
}

describe('readStoredTheme storage errors', () => {
  test('falls back to the system theme when localStorage is blocked', () => {
    const restore = withThrowingStorage();
    try {
      expect(readStoredTheme()).toBe('light');
    } finally {
      restore();
    }
  });
});
