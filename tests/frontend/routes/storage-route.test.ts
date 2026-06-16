import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';
import { storagePath } from '../../../frontend/src/routePaths';

describe('storage route helpers', () => {
  test('points to the storage backend viewer route', () => {
    expect(storagePath()).toBe('/storage');
  });

  test('describes storage backend page chrome', () => {
    expect(routeMeta('/storage')).toMatchObject({
      title: 'Storage backend',
      eyebrow: 'Storage',
      description: 'Backend config viewer from /api/settings/system.',
    });
  });
});
