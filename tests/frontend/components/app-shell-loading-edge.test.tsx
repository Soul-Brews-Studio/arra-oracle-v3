import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../../frontend/src/components/AppShell';
import { StudioSummary } from '../../../frontend/src/components/StudioSummary';
import { htmlFor, installBrowserLocation } from '../_render';

/**
 * Loading state after #2848 splits along the same seam as everything else: the refresh
 * control is shell chrome and stays here; the summary spinners moved to StudioSummary with
 * the counters they belong to.
 *
 * This file previously asserted `aria-label="Summary"` inside the shell, which is exactly
 * what #2848 removed — so it went red on alpha and nobody saw it, because CI runs a fixed
 * file list that does not include it (#2853).
 */
function shellHtml(): string {
  return htmlFor(
    <MemoryRouter initialEntries={['/metrics']}>
      <AppShell error="" loading metricsLoading menuCount={9} pluginCount={2} surfaceCount={4} updatedAt="soon" onRefresh={() => {}}>
        <p>metrics body</p>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell loading state edges', () => {
  test('the refresh control is disabled while backend data refreshes', () => {
    const restore = installBrowserLocation('/metrics');
    try {
      const html = shellHtml();
      expect(html).toContain('disabled="" type="button"');
      expect(html).toContain('metrics body');
      expect(html).not.toContain('Could not load backend data.');
    } finally {
      restore();
    }
  });

  test('the shell shows no summary and no summary spinners', () => {
    const restore = installBrowserLocation('/metrics');
    try {
      const html = shellHtml();
      expect(html).not.toContain('aria-label="Summary"');
      expect(html).not.toContain('aria-label="Backend summary"');
      expect(html).not.toContain('aria-label="Loading metrics"');
    } finally {
      restore();
    }
  });

  test('StudioSummary carries the loading affordances instead', () => {
    const html = htmlFor(
      <StudioSummary loading metricsLoading menuCount={9} pluginCount={2} surfaceCount={4} updatedAt="soon" />,
    );
    expect(html).toContain('aria-label="Backend summary"');
    expect(html).toContain('role="status" aria-label="Loading"');
    expect(html).toContain('role="status" aria-label="Loading metrics"');
  });
});
