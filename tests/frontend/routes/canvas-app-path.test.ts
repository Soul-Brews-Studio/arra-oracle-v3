import { describe, expect, test } from 'bun:test';
import { canvasAppPath } from '../../../frontend/src/routePaths';

describe('canvasAppPath', () => {
  test('preserves the Studio /canvas plugin query alias', () => {
    expect(canvasAppPath('wave')).toBe('/canvas?plugin=wave');
    expect(canvasAppPath('')).toBe('/canvas');
  });
});
