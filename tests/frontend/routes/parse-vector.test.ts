import { describe, expect, test } from 'bun:test';
import { parseRouteHash } from '../../../frontend/src/routePaths';

describe('parseRouteHash vector results', () => {
  test('reads trimmed vector queries from the hash query string', () => {
    expect(parseRouteHash('#/vector-search?q=oracle+memory+')).toEqual({ kind: 'vector-results', query: 'oracle memory' });
  });
});
