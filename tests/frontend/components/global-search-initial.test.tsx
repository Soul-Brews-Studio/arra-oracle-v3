import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { GlobalSearch } from '../../../frontend/src/components/GlobalSearch';
import { htmlFor } from '../_render';

describe('GlobalSearch initial state', () => {
  test('renders a global search input for menu, plugin, and MCP surfaces', () => {
    const html = htmlFor(<MemoryRouter><GlobalSearch /></MemoryRouter>);
    expect(html).toContain('Search all surfaces');
    expect(html).toContain('Search menu, plugins, MCP tools…');
  });
});
