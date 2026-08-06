import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell Tauri badge', () => {
  test('renders the desktop backend badge in the header when Tauri is present', () => {
    const restore = installBrowserLocation('/');
    Object.assign(globalThis.window, { __TAURI__: {} });
    try {
      const html = htmlFor(
        <MemoryRouter>
          <AppShell error="" loading={false} menuCount={1} pluginCount={0} surfaceCount={0} updatedAt="now" onRefresh={() => {}}>
            <p>content</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('Desktop');
      expect(html).toContain('Desktop backend connected');
    } finally {
      restore();
    }
  });
});
