import { describe, expect, test } from 'bun:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { McpToolDetailPage } from '../../../frontend/src/pages/McpToolDetailPage';
import { htmlFor } from '../_render';

describe('McpToolDetailPage loading state', () => {
  test('renders the decoded tool detail shell before tools load', () => {
    const html = htmlFor(
      <MemoryRouter initialEntries={['/mcp/tools/plugin%3Aecho']}>
        <Routes><Route path="/mcp/tools/:name" element={<McpToolDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(html).toContain('MCP tool detail');
    expect(html).toContain('Loading tool detail…');
  });
});
