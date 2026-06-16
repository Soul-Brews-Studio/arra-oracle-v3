import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell Vector navigation', () => {
  test('links to every vector page from the sidebar', () => {
    const restore = installBrowserLocation('/vector/search');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/vector/search']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Vector Dashboard: Collection health and indexing"');
      expect(html).toContain('aria-label="Document Browser: Browse indexed vector documents"');
      expect(html).toContain('aria-label="Vector Search: Semantic preview by collection"');
      expect(html).toContain('aria-label="Export App: Legacy v2 JSON/Markdown backups"');
      expect(html).toContain('aria-label="Export: Download vector collections"');
    } finally {
      restore();
    }
  });
});
