import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { McpPage } from '../../../frontend/src/pages/McpPage';
import { htmlFor } from '../_render';

describe('McpPage', () => {
  test('renders the MCP tool browser route surface', () => {
    const html = htmlFor(<MemoryRouter><McpPage /></MemoryRouter>);
    expect(html).toContain('Tool browser');
    expect(html).toContain('Live tool schemas from /api/mcp/tools.');
  });
});
