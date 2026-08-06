import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';

describe('vector route metadata', () => {
  test('describes dashboard and export page chrome', () => {
    expect(routeMeta('/vector')).toMatchObject({ title: 'Vector dashboard', eyebrow: 'Vector' });
    expect(routeMeta('/vector/export')).toMatchObject({
      title: 'Vector export',
      description: 'Download vector collections in available formats.',
    });
    expect(routeMeta('/vector/index')).toMatchObject({
      title: 'Index Manager',
      description: 'Track vector backfill jobs and reindex collections.',
    });
    expect(routeMeta('/vector/first-run')).toMatchObject({
      title: 'First-run setup',
      description: 'Use the local backend default, review cost, and start the first vector index.',
    });
    expect(routeMeta('/memory/consolidation')).toMatchObject({
      title: 'Consolidation review',
      description: 'Review pending supersede suggestions before applying them.',
    });
  });
});
