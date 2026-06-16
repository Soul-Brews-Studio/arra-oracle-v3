import { describe, expect, test } from 'bun:test';
import { VectorSearchWidget } from '../../../frontend/src/components/VectorSearchWidget';
import { htmlFor } from '../_render';

describe('VectorSearchWidget accessibility labels', () => {
  test('labels the search form and query input', () => {
    const html = htmlFor(<VectorSearchWidget />);
    expect(html).toContain('aria-label="Vector search form"');
    expect(html).toContain('aria-label="Vector search query"');
  });
});
