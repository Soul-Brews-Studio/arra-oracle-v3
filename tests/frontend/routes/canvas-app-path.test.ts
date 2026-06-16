import { describe, expect, test } from 'bun:test';
import { canvasAppPath, canvasStandalonePath, canvasStandaloneUrl } from '../../../frontend/src/routePaths';

describe('canvas route helpers', () => {
  test('preserves the Studio /canvas plugin query alias', () => {
    expect(canvasAppPath('wave')).toBe('/canvas?plugin=wave');
    expect(canvasAppPath('')).toBe('/canvas');
  });

  test('maps standalone canvas plugins to clean and query URLs', () => {
    expect(canvasStandalonePath('map')).toBe('/map');
    expect(canvasStandalonePath('planets')).toBe('/planets');
    expect(canvasStandalonePath('wave')).toBe('/?plugin=wave');
    expect(canvasStandaloneUrl('torus')).toBe('https://canvas.buildwithoracle.com/?plugin=torus');
  });
});
