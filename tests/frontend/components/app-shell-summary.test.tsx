import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { StudioSummary } from '../../../frontend/src/components/StudioSummary';
import { htmlFor, installBrowserLocation } from '../_render';

/**
 * These assertions were inverted by #2848: the backend-wide stat strip used to render in
 * AppShell above {children} with no condition, so it appeared on all 34 routes — /metrics
 * showed 13 stat cards, /tools/config showed 5 that were about nothing on the page. The
 * counters are dashboard *content*, so they moved to StudioSummary, owned by the / route.
 *
 * The tests below now pin that split in BOTH directions, which is what #2848 should have
 * done and did not — CI's file list does not include this file, so it stayed red on alpha
 * unnoticed (see #2853).
 */
describe('AppShell summary', () => {
  test('the shell does NOT render backend counters — that is route content', () => {
    const restore = installBrowserLocation('/plugins');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/plugins']}>
          <AppShell error="" loading={false} menuCount={2} pluginCount={1} surfaceCount={4} updatedAt="10:00" onRefresh={() => {}}>
            <p>child content</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(html).toContain('child content');
      expect(html).not.toContain('Menu items');
      expect(html).not.toContain('Surfaces');
      expect(html).not.toContain('updated 10:00');
      expect(html).not.toContain('Backend summary');
    } finally {
      restore();
    }
  });

  test('StudioSummary renders those counters instead, unchanged', () => {
    const html = htmlFor(
      <StudioSummary loading={false} menuCount={2} pluginCount={1} surfaceCount={4} updatedAt="10:00" />,
    );
    expect(html).toContain('Menu items');
    expect(html).toContain('Surfaces');
    expect(html).toContain('updated 10:00');
    expect(html).toContain('Backend summary');
  });

  test('exactly one h1 per screen — the page owns it, not the brand mark', () => {
    const restore = installBrowserLocation('/plugins');
    try {
      const html = htmlFor(
        <MemoryRouter initialEntries={['/plugins']}>
          <AppShell error="" loading={false} menuCount={2} pluginCount={1} surfaceCount={4} updatedAt="10:00" onRefresh={() => {}}>
            <p>child content</p>
          </AppShell>
        </MemoryRouter>,
      );
      // NavSidebar's brand mark was an <h1>, so screen readers announced the shell as the
      // document title on every route. It is a <p> now; the route header keeps the only h1.
      expect(html.match(/<h1/g) ?? []).toHaveLength(1);
      expect(html).not.toContain('<h1 class="mt-2 text-xl font-bold');
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
