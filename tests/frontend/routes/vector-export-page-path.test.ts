import { describe, expect, test } from 'bun:test';
import { vectorExportPagePath } from '../../../frontend/src/routePaths';

describe('vectorExportPagePath', () => {
  test('points at the vector export page route', () => {
    expect(vectorExportPagePath()).toBe('/vector/export');
  });
});
