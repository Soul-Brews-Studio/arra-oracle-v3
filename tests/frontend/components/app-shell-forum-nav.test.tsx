import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell forum navigation', () => {
  test('links to the forum page from the sidebar', () => {
    const restore = installBrowserLocation('/forum');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/forum']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Forum: Operational threads from /api/threads"');
    } finally {
      restore();
    }
  });
});
