import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';

describe('learn route metadata', () => {
  test('describes the Learn page route chrome', () => {
    expect(routeMeta('/learn')).toMatchObject({
      title: 'Learn entries',
      eyebrow: 'Learn',
      description: 'Capture and edit Oracle learnings.',
    });
  });
});
