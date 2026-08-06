import { describe, expect, test } from 'bun:test';
import { contentPreview } from '../../../frontend/src/pages/VectorSearchPage';

describe('VectorSearchPage content preview', () => {
  test('compacts whitespace and truncates long content previews', () => {
    const preview = contentPreview('Oracle\n\nmemory '.repeat(20), 24);

    expect(preview).toBe('Oracle memory Oracle me…');
  });
});
