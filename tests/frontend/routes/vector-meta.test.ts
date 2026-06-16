import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';

describe('vector route metadata', () => {
  test('describes dashboard and export page chrome', () => {
    expect(routeMeta('/vector')).toMatchObject({ title: 'Vector dashboard', eyebrow: 'Vector' });
    expect(routeMeta('/vector/export')).toMatchObject({
      title: 'Vector export',
      description: 'Download vector collections in available formats.',
    });
  });
});
