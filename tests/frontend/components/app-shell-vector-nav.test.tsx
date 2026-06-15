import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell Vector navigation', () => {
  test('links to the vector search preview page from the sidebar', () => {
    const restore = installBrowserLocation('/vector/search');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/vector/search']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Vector: Semantic preview by collection"');
    } finally {
      restore();
    }
  });
});
