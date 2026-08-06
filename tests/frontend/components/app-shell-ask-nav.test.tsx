import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell ask navigation', () => {
  test('links to Studio Ask from the sidebar', () => {
    const restore = installBrowserLocation('/ask');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/ask']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('aria-label="Ask: Cited RAG answers from /api/v1/ask"');
      expect(html).toContain('aria-current="page"');
    } finally {
      restore();
    }
  });
});
