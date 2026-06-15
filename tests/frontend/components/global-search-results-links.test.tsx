import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { GlobalSearchResults } from '../../../frontend/src/components/GlobalSearch';
import { htmlFor } from '../_render';

describe('GlobalSearchResults links', () => {
  test('renders labeled result links for unified search matches', () => {
    const html = htmlFor(
      <MemoryRouter>
        <GlobalSearchResults results={[{ id: 'mcp:echo', surface: 'mcp-tool', title: 'echo.tool', detail: 'Echo helper', href: '/mcp/tools/echo.tool', keywords: '' }]} />
      </MemoryRouter>,
    );
    expect(html).toContain('MCP tool');
    expect(html).toContain('echo.tool');
    expect(html).toContain('href="/mcp/tools/echo.tool"');
  });
});
