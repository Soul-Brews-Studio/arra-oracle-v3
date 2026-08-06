import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';
import { askPath } from '../../../frontend/src/routePaths';

describe('ask route helpers', () => {
  test('describes Studio Ask in route chrome', () => {
    expect(routeMeta('/ask')).toMatchObject({
      title: 'Studio Ask',
      eyebrow: 'Ask',
      description: 'Cited RAG answers from /api/v1/ask.',
    });
  });

  test('builds optional question URLs', () => {
    expect(askPath()).toBe('/ask');
    expect(askPath(' stale source ')).toBe('/ask?q=stale+source');
  });
});
