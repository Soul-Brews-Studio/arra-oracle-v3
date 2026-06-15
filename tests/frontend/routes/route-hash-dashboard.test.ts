import { describe, expect, test } from 'bun:test';
import { routeHash } from '../../../frontend/src/routePaths';

describe('routeHash dashboard', () => {
  test('uses the root hash for the dashboard', () => {
    expect(routeHash({ kind: 'dashboard' })).toBe('#/');
  });
});
