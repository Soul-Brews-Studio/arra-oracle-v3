import { describe, expect, test } from 'bun:test';
import { readStoredTheme } from '../../../frontend/src/theme';

function withoutBrowserGlobals() {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  return () => {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  };
}

describe('readStoredTheme without browser globals', () => {
  test('falls back to light without throwing', () => {
    const restore = withoutBrowserGlobals();
    try {
      expect(readStoredTheme()).toBe('light');
    } finally {
      restore();
    }
  });
});
