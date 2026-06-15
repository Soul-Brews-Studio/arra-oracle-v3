import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { PageChrome } from '../../../frontend/src/components/PageChrome';
import { routeMeta } from '../../../frontend/src/routeMeta';
import { htmlFor } from '../_render';

describe('PageChrome breadcrumbs', () => {
  test('marks the current breadcrumb for assistive tech', () => {
    const html = htmlFor(
      <MemoryRouter>
        <PageChrome meta={routeMeta('/settings')} />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Settings');
  });
});
