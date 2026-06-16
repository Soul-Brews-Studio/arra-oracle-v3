import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell Learn navigation', () => {
  test('links to the learn CRUD page from the sidebar', () => {
    const restore = installBrowserLocation('/learn');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/learn']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Learn: Create and edit learnings"');
    } finally {
      restore();
    }
  });
});
