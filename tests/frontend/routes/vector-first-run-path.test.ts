import { describe, expect, test } from 'bun:test';
import { vectorFirstRunPath } from '../../../frontend/src/routePaths';

describe('vectorFirstRunPath', () => {
  test('points to the first-run onboarding route', () => {
    expect(vectorFirstRunPath()).toBe('/vector/first-run');
  });
});
