import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';

describe('forum route metadata', () => {
  test('describes the forum thread surface', () => {
    expect(routeMeta('/forum')).toMatchObject({
      title: 'Forum threads',
      eyebrow: 'Forum',
      description: 'Operational thread list from /api/threads.',
    });
  });
});
