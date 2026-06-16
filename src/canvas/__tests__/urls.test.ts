import { describe, expect, test } from 'bun:test';

import {
  CANVAS_ORIGIN,
  canvasPluginAbsoluteUrl,
  canvasPluginDataPath,
  canvasPluginPath,
} from '../index.ts';

describe('canvas URL helpers', () => {
  test('maps react plugins to clean standalone paths', () => {
    expect(canvasPluginPath('map')).toBe('/map');
    expect(canvasPluginPath('planets')).toBe('/planets');
    expect(canvasPluginAbsoluteUrl('map')).toBe(`${CANVAS_ORIGIN}/map`);
  });

  test('maps three plugins to query-string standalone paths', () => {
    expect(canvasPluginPath('wave')).toBe('/?plugin=wave');
    expect(canvasPluginPath('')).toBe('/?plugin=wave');
    expect(canvasPluginAbsoluteUrl('map3d')).toBe(`${CANVAS_ORIGIN}/?plugin=map3d`);
  });

  test('exposes data API only for react canvas plugins', () => {
    expect(canvasPluginDataPath('map')).toBe('/api/map3d');
    expect(canvasPluginDataPath('planets')).toBe('/api/map3d');
    expect(canvasPluginDataPath('wave')).toBeUndefined();
  });
});
