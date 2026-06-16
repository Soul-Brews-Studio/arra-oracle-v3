import { describe, expect, test } from 'bun:test';
import { previewFor } from '../../../frontend/src/components/searchResultView';

describe('previewFor empty content', () => {
  test('uses a fallback preview when content is empty', () => {
    expect(previewFor({ id: '1', content: '' })).toBe('No preview returned.');
  });
});
