import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { SearchPage } from '../../../frontend/src/pages/SearchPage';
import { htmlFor } from '../_render';

describe('Search page', () => {
  test('renders search helper text and global search form', () => {
    const html = htmlFor(<MemoryRouter><SearchPage /></MemoryRouter>);
    expect(html).toContain('Full-text menu search');
    expect(html).toContain('Search boundaries');
  });
});
