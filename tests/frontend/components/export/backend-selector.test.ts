import { describe, expect, test } from 'bun:test';
import { DEFAULT_BACKEND_URL, normalizeBackendUrl, uniqueBackendUrls } from '../../../../frontend/src/components/export/BackendSelector';

describe('export BackendSelector helpers', () => {
  test('normalizes backend URLs for local API targets', () => {
    expect(normalizeBackendUrl('')).toBe(DEFAULT_BACKEND_URL);
    expect(normalizeBackendUrl('localhost:47778/')).toBe(DEFAULT_BACKEND_URL);
    expect(normalizeBackendUrl('https://oracle.example/api/')).toBe('https://oracle.example/api');
  });

  test('deduplicates saved backend URLs after normalization', () => {
    expect(uniqueBackendUrls(['localhost:47778', DEFAULT_BACKEND_URL])).toEqual([DEFAULT_BACKEND_URL]);
  });
});
