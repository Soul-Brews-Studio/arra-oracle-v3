import { describe, expect, test } from 'bun:test';
import { parseRouteHash } from '../../../frontend/src/routePaths';

describe('parseRouteHash dashboard', () => {
  test('falls back to the dashboard for unknown hashes', () => {
    expect(parseRouteHash('#/unknown')).toEqual({ kind: 'dashboard' });
  });
});
