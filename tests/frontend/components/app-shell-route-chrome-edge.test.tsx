import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { htmlFor, installBrowserLocation } from '../_render';

describe('AppShell route chrome edge cases', () => {
  test('renders query-aware vector result chrome in the layout shell', () => {
    const restore = installBrowserLocation('/vector/results?q=oracle');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/vector/results?q=oracle']}>
          <AppShell error="" loading={false} menuCount={1} pluginCount={2} surfaceCount={3} updatedAt="12:00" onRefresh={() => {}}>
            <p>results body</p>
          </AppShell>
        </MemoryRouter>,
      );

      expect(html).toContain('Vector search results');
      expect(html).toContain('Semantic matches for “oracle”.');
      expect(html).toContain('Results: oracle');
      expect(html).toContain('results body');
    } finally {
      restore();
    }
  });

  test('keeps metric cards stable when metrics are still unavailable', () => {
    const restore = installBrowserLocation('/menu');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/menu']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} metrics={null} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );

      expect(html).toContain('Requests');
      expect(html).toContain('Avg response');
      expect(html).toContain('from /api/v1/metrics');
      expect(html).toContain('—');
    } finally {
      restore();
    }
  });
});
