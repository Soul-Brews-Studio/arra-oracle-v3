import { describe, expect, test } from 'bun:test';
import { previewFor } from '../../../frontend/src/components/searchResultView';

describe('previewFor', () => {
  test('truncates long result content', () => {
    const content = 'a'.repeat(321);
    expect(previewFor({ id: '1', content })).toBe(`${'a'.repeat(320)}…`);
  });
});
