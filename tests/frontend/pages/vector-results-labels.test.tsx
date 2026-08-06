import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { VectorSearchResultsPage } from '../../../frontend/src/pages/VectorSearchResultsPage';
import { htmlFor } from '../_render';

describe('VectorSearchResultsPage accessibility labels', () => {
  test('labels the full-page vector search controls', () => {
    const html = htmlFor(<MemoryRouter initialEntries={['/vector/results']}><VectorSearchResultsPage /></MemoryRouter>);
    expect(html).toContain('aria-label="Full-page vector search form"');
    expect(html).toContain('aria-label="Vector search query"');
    expect(html).toContain('aria-label="Run vector search"');
    expect(html).toContain('Memory health');
  });
});
