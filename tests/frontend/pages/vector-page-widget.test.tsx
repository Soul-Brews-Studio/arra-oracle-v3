import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { VectorPage } from '../../../frontend/src/pages/VectorPage';
import { htmlFor } from '../_render';

describe('VectorPage', () => {
  test('renders the vector search widget route surface', () => {
    const html = htmlFor(<MemoryRouter><VectorPage /></MemoryRouter>);
    expect(html).toContain('Vector search');
    expect(html).toContain('Semantic search against Oracle memory');
  });
});
