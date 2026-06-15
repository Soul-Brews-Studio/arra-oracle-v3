import { describe, expect, test } from 'bun:test';
import { parseRouteHash } from '../../../frontend/src/routePaths';

describe('parseRouteHash empty vector results', () => {
  test('keeps vector result routes with no query as a results page', () => {
    expect(parseRouteHash('#/vector-search')).toEqual({ kind: 'vector-results', query: '' });
  });
});
