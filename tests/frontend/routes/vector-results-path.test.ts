import { describe, expect, test } from 'bun:test';
import { vectorResultsPath } from '../../../frontend/src/routePaths';

describe('vectorResultsPath', () => {
  test('encodes vector result queries in the route query string', () => {
    expect(vectorResultsPath('oracle memory')).toBe('/search/results?q=oracle+memory');
  });
});
