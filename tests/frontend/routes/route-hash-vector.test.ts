import { describe, expect, test } from 'bun:test';
import { routeHash } from '../../../frontend/src/routePaths';

describe('routeHash vector results', () => {
  test('encodes vector result queries in the hash query string', () => {
    expect(routeHash({ kind: 'vector-results', query: 'oracle memory' })).toBe('#/vector-search?q=oracle+memory');
  });
});
