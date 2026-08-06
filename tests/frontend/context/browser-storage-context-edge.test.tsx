import { describe, expect, test } from 'bun:test';
import { BackendSelector, DEFAULT_BACKEND_URL, readSavedBackendUrls } from '../../../frontend/src/components/export/BackendSelector';
import { readFirstRunComplete } from '../../../frontend/src/hooks/useFirstRun';
import { htmlFor } from '../_render';

function withoutWindow() {
  const previousWindow = globalThis.window;
  Reflect.deleteProperty(globalThis, 'window');
  return () => { globalThis.window = previousWindow; };
}

describe('browser storage context edges', () => {
  test('store helpers keep safe defaults outside a browser context', () => {
    const restore = withoutWindow();
    try {
      expect(readSavedBackendUrls()).toEqual([DEFAULT_BACKEND_URL]);
      expect(readFirstRunComplete()).toBe(false);
    } finally {
      restore();
    }
  });

  test('BackendSelector renders with the default backend when storage is absent', () => {
    const restore = withoutWindow();
    try {
      const html = htmlFor(<BackendSelector value="" onChange={() => {}} />);
      expect(html).toContain('Saved backend');
      expect(html).toContain(DEFAULT_BACKEND_URL);
      expect(html).toContain('Backend URL');
    } finally {
      restore();
    }
  });
});
