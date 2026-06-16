import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { GlobalSearch } from '../../../frontend/src/components/GlobalSearch';
import { htmlFor } from '../_render';

describe('GlobalSearch a11y edges', () => {
  test('renders a labelled search form and disables empty submissions', () => {
    const html = htmlFor(<MemoryRouter><GlobalSearch /></MemoryRouter>);

    expect(html).toContain('aria-label="Global frontend search"');
    expect(html).toContain('role="search"');
    expect(html).toContain('for="global-search"');
    expect(html).toContain('id="global-search"');
    expect(html).toContain('disabled=""');
  });
});
