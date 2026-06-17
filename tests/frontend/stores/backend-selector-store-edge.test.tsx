import { describe, expect, test } from 'bun:test';
import {
  BACKEND_URLS_KEY,
  BackendSelector,
  DEFAULT_BACKEND_URL,
  normalizeBackendUrl,
  readSavedBackendUrls,
  writeSavedBackendUrls,
} from '../../../frontend/src/components/export/BackendSelector';
import { htmlFor, installBrowserLocation } from '../_render';

function withThrowingStorage(setItem: () => void) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: () => '[]', setItem } as unknown as Storage,
  } as unknown as Window & typeof globalThis;
  return () => { globalThis.window = previousWindow; };
}

describe('backend selector store edge cases', () => {
  test('normalizes blank, schemeless, and slash-padded backend URLs', () => {
    expect(normalizeBackendUrl('   ')).toBe(DEFAULT_BACKEND_URL);
    expect(normalizeBackendUrl('oracle.local:47778///')).toBe('http://oracle.local:47778');
    expect(normalizeBackendUrl('https://oracle.example/api///')).toBe('https://oracle.example/api');
  });

  test('renders custom selected backends without writing to the default store key', () => {
    const restore = installBrowserLocation('/export');
    try {
      window.localStorage.setItem('custom-backends', JSON.stringify(['oracle.local:47778/']));
      const html = htmlFor(<BackendSelector value="https://custom.example/" onChange={() => {}} storageKey="custom-backends" />);

      expect(readSavedBackendUrls('custom-backends')).toEqual([DEFAULT_BACKEND_URL, 'http://oracle.local:47778']);
      expect(window.localStorage.getItem(BACKEND_URLS_KEY)).toBe(null);
      expect(html).toContain('Custom backend');
      expect(html).toContain('value="https://custom.example/"');
    } finally {
      restore();
    }
  });

  test('returns normalized URLs even when browser storage rejects writes', () => {
    const restore = withThrowingStorage(() => { throw new Error('quota exceeded'); });
    try {
      expect(() => writeSavedBackendUrls(['https://oracle.example/'])).not.toThrow();
      expect(writeSavedBackendUrls(['https://oracle.example/'])).toEqual([DEFAULT_BACKEND_URL, 'https://oracle.example']);
    } finally {
      restore();
    }
  });
});
