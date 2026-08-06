import { describe, expect, test } from 'bun:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { McpToolDetailPage } from '../../../frontend/src/pages/McpToolDetailPage';
import { htmlFor } from '../_render';

describe('McpToolDetailPage loading status', () => {
  test('announces the loading state as status text', () => {
    const html = htmlFor(
      <MemoryRouter initialEntries={['/mcp/tools/plugin%3Aecho']}>
        <Routes><Route path="/mcp/tools/:name" element={<McpToolDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading tool detail…');
  });
});
