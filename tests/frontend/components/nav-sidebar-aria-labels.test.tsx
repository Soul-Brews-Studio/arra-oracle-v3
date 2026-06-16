import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { NavSidebar } from '../../../frontend/src/components/NavSidebar';
import { htmlFor } from '../_render';

describe('NavSidebar accessibility labels', () => {
  test('labels the navigation landmark and route links', () => {
    const html = htmlFor(
      <MemoryRouter>
        <NavSidebar items={[{ to: '/menu', label: 'Menu', description: 'Navigation rows' }]} />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Application navigation"');
    expect(html).toContain('aria-label="Arra Oracle control surface home"');
    expect(html).toContain('aria-label="Menu: Navigation rows"');
  });
});
