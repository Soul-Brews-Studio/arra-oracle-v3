import { describe, expect, test } from 'bun:test';
import {
  BACKEND_URLS_KEY,
  DEFAULT_BACKEND_URL,
  readSavedBackendUrls,
  writeSavedBackendUrls,
} from '../../../frontend/src/components/export/BackendSelector';
import { installBrowserLocation } from '../_render';

describe('backend selector localStorage store', () => {
  test('returns the default backend without browser storage', () => {
    expect(readSavedBackendUrls()).toEqual([DEFAULT_BACKEND_URL]);
  });

  test('normalizes, dedupes, and persists saved backend URLs', () => {
    const restore = installBrowserLocation('/export');
    try {
      const saved = writeSavedBackendUrls(['localhost:47778/', 'oracle.local:47778']);
      expect(saved).toEqual([DEFAULT_BACKEND_URL, 'http://oracle.local:47778']);
      expect(JSON.parse(window.localStorage.getItem(BACKEND_URLS_KEY) || '[]')).toEqual(saved);
      expect(readSavedBackendUrls()).toEqual(saved);
    } finally {
      restore();
    }
  });

  test('ignores invalid stored JSON and non-string entries', () => {
    const restore = installBrowserLocation('/export');
    try {
      window.localStorage.setItem(BACKEND_URLS_KEY, '{bad');
      expect(readSavedBackendUrls()).toEqual([DEFAULT_BACKEND_URL]);
      window.localStorage.setItem(BACKEND_URLS_KEY, JSON.stringify(['https://oracle.example/', 7, null]));
      expect(readSavedBackendUrls()).toEqual([DEFAULT_BACKEND_URL, 'https://oracle.example']);
    } finally {
      restore();
    }
  });
});
