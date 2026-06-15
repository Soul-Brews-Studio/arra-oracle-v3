import { describe, expect, test } from 'bun:test';
import { vectorResultsPath } from '../../../frontend/src/routePaths';

describe('vectorResultsPath empty query', () => {
  test('omits the q parameter when no query is present', () => {
    expect(vectorResultsPath('  ')).toBe('/search/results');
  });
});
