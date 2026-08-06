import { describe, expect, test } from 'bun:test';
import { menuCatalogPath } from '../../../frontend/src/routePaths';

describe('menuCatalogPath', () => {
  test('builds shareable menu filter URLs', () => {
    expect(menuCatalogPath()).toBe('/menu');
    expect(menuCatalogPath({ group: 'tools', source: 'plugin:echo' })).toBe('/menu?group=tools&source=plugin%3Aecho');
    expect(menuCatalogPath({ group: 'all', source: 'all' })).toBe('/menu');
  });
});
