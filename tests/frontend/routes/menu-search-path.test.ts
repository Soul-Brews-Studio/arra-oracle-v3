import { describe, expect, test } from 'bun:test';
import { menuSearchPath } from '../../../frontend/src/routePaths';

describe('menuSearchPath', () => {
  test('encodes shareable menu search routes', () => {
    expect(menuSearchPath(' oracle menu ')).toBe('/search?q=oracle+menu');
  });

  test('omits empty q parameters', () => {
    expect(menuSearchPath('  ')).toBe('/search');
  });
});
