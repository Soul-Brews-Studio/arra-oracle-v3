import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { VectorSearchResultsPage } from '../../../frontend/src/pages/VectorSearchResultsPage';
import { htmlFor } from '../_render';

describe('VectorSearchResultsPage empty query', () => {
  test('prompts for a query when the route has no q parameter', () => {
    const html = htmlFor(<MemoryRouter initialEntries={['/vector/results']}><VectorSearchResultsPage /></MemoryRouter>);
    expect(html).toContain('Vector search results');
    expect(html).toContain('Enter a query to run a vector search.');
  });
});
