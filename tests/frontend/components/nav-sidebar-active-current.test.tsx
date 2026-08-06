import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { NavSidebar } from '../../../frontend/src/components/NavSidebar';
import { htmlFor } from '../_render';

describe('NavSidebar active route a11y', () => {
  test('marks the active route and keeps badge text available to assistive tech', () => {
    const html = htmlFor(
      <MemoryRouter initialEntries={['/plugins']}>
        <NavSidebar items={[
          { to: '/', label: 'Menu', description: 'Navigation rows', end: true },
          { to: '/plugins', label: 'Plugins', description: 'Registered plugin surfaces', badge: 3 },
        ]} />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="Frontend sections"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Plugins: Registered plugin surfaces"');
    expect(html).toContain('bg-accent-soft text-accent');
    expect(html).toContain('aria-label="3 items"');
    expect(html).toContain('>3</span>');
  });
});
