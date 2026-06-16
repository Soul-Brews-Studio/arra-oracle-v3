import { describe, expect, test } from 'bun:test';
import { VectorSearchPage } from '../../../frontend/src/pages/VectorSearchPage';
import { htmlFor } from '../_render';

describe('VectorSearchPage controls', () => {
  test('renders query, collection, and submit controls for vector preview', () => {
    const html = htmlFor(<VectorSearchPage />);

    expect(html).toContain('Vector search preview');
    expect(html).toContain('aria-label="Vector search query"');
    expect(html).toContain('aria-label="Vector collection"');
    expect(html).toContain('aria-label="Submit vector search"');
    expect(html).toContain('/api/v1/vector/search');
  });
});
