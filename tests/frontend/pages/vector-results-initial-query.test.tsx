import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { VectorSearchResultsPage } from '../../../frontend/src/pages/VectorSearchResultsPage';
import { htmlFor } from '../_render';

describe('VectorSearchResultsPage initial query', () => {
  test('seeds the search input from the q route parameter', () => {
    const html = htmlFor(<MemoryRouter initialEntries={['/vector/results?q=oracle']}><VectorSearchResultsPage /></MemoryRouter>);
    expect(html).toContain('value="oracle"');
    expect(html).toContain('Back to vector search');
  });
});
