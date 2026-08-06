import { describe, expect, test } from 'bun:test';
import { vectorDocumentsPath } from '../../../frontend/src/routePaths';

describe('vectorDocumentsPath', () => {
  test('points at the vector document browser route', () => {
    expect(vectorDocumentsPath()).toBe('/vector/documents');
  });
});
