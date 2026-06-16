import { describe, expect, test } from 'bun:test';
import { vectorDashboardPath } from '../../../frontend/src/routePaths';

describe('vectorDashboardPath', () => {
  test('points at the vector dashboard route', () => {
    expect(vectorDashboardPath()).toBe('/vector');
  });
});
