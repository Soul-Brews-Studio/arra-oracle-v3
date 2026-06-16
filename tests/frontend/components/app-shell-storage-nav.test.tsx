import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell storage navigation', () => {
  test('links to the storage backend viewer from the sidebar', () => {
    const restore = installBrowserLocation('/storage');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/storage']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Storage: Backend config from /api/settings/system"');
    } finally {
      restore();
    }
  });
});
