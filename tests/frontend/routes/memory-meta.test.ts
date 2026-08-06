import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';

describe('memory route metadata', () => {
  test('describes the Memory dashboard route chrome', () => {
    expect(routeMeta('/memory')).toMatchObject({
      title: 'Memory dashboard',
      eyebrow: 'Memory',
      description: 'Provenance, confidence, heat, valid-time, and recency across Studio memory.',
    });
  });
});
