import { describe, expect, test } from 'bun:test';
import { vectorSearchPath } from '../../../frontend/src/routePaths';

describe('vectorSearchPath', () => {
  test('encodes shareable vector search preview routes', () => {
    expect(vectorSearchPath(' oracle memory ')).toBe('/vector/search?q=oracle+memory');
    expect(vectorSearchPath()).toBe('/vector/search');
  });
});
