import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell skip link', () => {
  test('renders a skip link targeting focusable main content', () => {
    const restore = installBrowserLocation('/menu');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/menu']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>main body</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('Skip to main content');
      expect(html).toContain('href="#main-content"');
      expect(html).toContain('id="main-content"');
      expect(html).toContain('tabindex="-1"');
    } finally {
      restore();
    }
  });
});
