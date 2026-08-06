import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { PageChrome } from '../../../frontend/src/components/PageChrome';
import type { RouteMeta } from '../../../frontend/src/routeMeta';
import { htmlFor } from '../_render';

const meta: RouteMeta = {
  title: 'Vector settings',
  description: 'Tune vector collections.',
  eyebrow: 'Vector',
  breadcrumbs: [
    { label: 'Vector', to: '/vector' },
    { label: 'Settings' },
  ],
};

describe('PageChrome breadcrumb a11y edges', () => {
  test('hides separators and exposes only the last crumb as current page', () => {
    const html = htmlFor(<MemoryRouter><PageChrome meta={meta} /></MemoryRouter>);

    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('href="/vector"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Vector settings');
  });
});
