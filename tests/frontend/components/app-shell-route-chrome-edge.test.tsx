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

  test('the shell renders no metric cards even when metrics are unavailable', () => {
    // Pre-#2848 this asserted the shell showed Requests / Avg response placeholders on every
    // route. Metrics are content for the routes that are about metrics; the shell renders
    // chrome. Absence is the property now, in both the loaded and unloaded cases.
    const restore = installBrowserLocation('/menu');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/menu']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} metrics={null} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );

      expect(html).toContain('child');
      expect(html).not.toContain('Avg response');
      expect(html).not.toContain('real-time backend latency');
      expect(html).not.toContain('Backend summary');
      // NOT `from /api/v1/metrics`: that string is also the Metrics nav item's description
      // (AppShell.tsx:82), which is chrome and belongs here. Asserting on it would fail for
      // a reason unrelated to the property under test.
    } finally {
      restore();
    }
  });

  test('the shell still renders its own chrome — refresh, search, theme', () => {
    // Guards the opposite over-correction: #2848 removed content, not chrome.
    const restore = installBrowserLocation('/menu');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/menu']}>
          <AppShell error="" loading={false} menuCount={0} pluginCount={0} surfaceCount={0} metrics={null} updatedAt="never" onRefresh={() => {}}>
            <p>child</p>
          </AppShell>
        </MemoryRouter>,
      );

      expect(html).toContain('Refresh data');
      expect(html).toContain('Search all surfaces');
      expect(html).toContain('Skip to main content');
    } finally {
      restore();
    }
  });
});
