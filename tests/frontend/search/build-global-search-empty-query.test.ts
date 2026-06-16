import { describe, expect, test } from 'bun:test';
import { buildGlobalSearchResults } from '../../../frontend/src/global-search';

describe('buildGlobalSearchResults empty query', () => {
  test('returns no unified results before the user enters text', () => {
    const results = buildGlobalSearchResults({ menu: [], plugins: [], tools: [] }, '   ');
    expect(results).toEqual([]);
  });
});
