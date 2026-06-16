import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell loading state edges', () => {
  test('disables refresh and shows loading summaries while backend data refreshes', () => {
    const restore = installBrowserLocation('/metrics');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/metrics']}>
          <AppShell error="" loading metricsLoading menuCount={9} pluginCount={2} surfaceCount={4} updatedAt="soon" onRefresh={() => {}}>
            <p>metrics body</p>
          </AppShell>
        </MemoryRouter>,
      );

      expect(html).toContain('aria-label="Summary"');
      expect(html).toContain('role="status" aria-label="Refreshing"');
      expect(html).toContain('role="status" aria-label="Loading metrics"');
      expect(html).toContain('disabled="" type="button"');
      expect(html).toContain('metrics body');
      expect(html).not.toContain('Could not load backend data.');
    } finally {
      restore();
    }
  });
});
