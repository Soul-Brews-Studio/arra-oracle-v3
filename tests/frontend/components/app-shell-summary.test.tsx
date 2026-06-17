import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell summary', () => {
  test('renders menu, plugin, and surface summary counts', () => {
    const restore = installBrowserLocation('/plugins');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/plugins']}>
          <AppShell error="" loading={false} menuCount={2} pluginCount={1} surfaceCount={4} updatedAt="10:00" onRefresh={() => {}}>
            <p>child content</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('Menu items');
      expect(html).toContain('Plugins');
      expect(html).toContain('Surfaces');
      expect(html).toContain('updated 10:00');
    } finally {
      restore();
    }
  });

  test('exposes the Simple Mode header link', () => {
    const restore = installBrowserLocation('/menu');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/menu']}>
          <AppShell error="" loading={false} menuCount={2} pluginCount={1} surfaceCount={4} updatedAt="10:00" onRefresh={() => {}}>
            <p>child content</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('href="/simple"');
      expect(html).toContain('Simple Mode');
    } finally {
      restore();
    }
  });
});
