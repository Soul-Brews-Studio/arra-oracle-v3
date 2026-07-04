import { describe, expect, test } from 'bun:test';

import {
  CANVAS_HOST,
  CANVAS_ORIGIN,
  DEFAULT_CANVAS_PLUGIN,
  canvasPluginAbsoluteUrl,
  canvasPluginDataPath,
  canvasPluginPath,
} from '../index.ts';

describe('canvas URL helpers', () => {
  test('exposes canonical canvas host and default plugin constants', () => {
    expect(CANVAS_HOST).toBe('canvas.buildwithoracle.com');
    expect(CANVAS_ORIGIN).toBe(`https://${CANVAS_HOST}`);
    expect(DEFAULT_CANVAS_PLUGIN).toBe('wave');
  });

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

  test('exposes DB/FTS map data API for memory-map canvas plugins', () => {
    expect(canvasPluginDataPath('map')).toBe('/api/map3d');
    expect(canvasPluginDataPath('map3d')).toBe('/api/map3d');
    expect(canvasPluginDataPath('planets')).toBe('/api/map3d');
    expect(canvasPluginDataPath('wave')).toBeUndefined();
  });
});
