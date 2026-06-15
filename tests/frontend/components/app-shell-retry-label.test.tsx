import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell retry action label', () => {
  test('labels the backend retry control for screen readers', () => {
    const restore = installBrowserLocation('/menu');
    try {
      const html = htmlFor(
        <MemoryRouter>
          <AppShell error="backend offline" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p />
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Retry loading backend dashboard data"');
    } finally {
      restore();
    }
  });
});
