import { describe, expect, test } from 'bun:test';
import { routeHash } from '../../../frontend/src/routePaths';

describe('routeHash empty vector results', () => {
  test('omits the q parameter when no query is present', () => {
    expect(routeHash({ kind: 'vector-results', query: '  ' })).toBe('#/vector-search');
  });
});
