import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell memory navigation', () => {
  test('links to the memory dashboard from the sidebar', () => {
    const restore = installBrowserLocation('/memory');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/memory']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Memory Dashboard: Confidence, heat, provenance, valid-time, and recency"');
    } finally {
      restore();
    }
  });
});
