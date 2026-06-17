import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell Canvas navigation', () => {
  test('links to the canvas registry with unified plugin metadata copy', () => {
    const restore = installBrowserLocation('/canvas/plugins');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/canvas/plugins']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Canvas Plugins: Canvas metadata from /api/plugins?kind=canvas"');
    } finally {
      restore();
    }
  });
});
