import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { NavSidebar } from '../../../frontend/src/components/NavSidebar';
import { htmlFor } from '../_render';

describe('NavSidebar overflow', () => {
  test('keeps the brand pinned and scrolls many large-screen nav items inside the sidebar', () => {
    const items = Array.from({ length: 32 }, (_, index) => ({
      to: `/section-${index}`,
      label: `Section ${index}`,
      description: 'Overflow regression item',
    }));
    const html = htmlFor(
      <MemoryRouter>
        <NavSidebar items={items} />
      </MemoryRouter>,
    );

    expect(html).toContain('lg:h-[calc(100vh-2rem)]');
    expect(html).toContain('aria-label="Arra Oracle control surface home"');
    expect(html).toContain('lg:min-h-0');
    expect(html).toContain('lg:overflow-y-auto');
    expect(html).not.toContain('lg:overflow-visible');
    expect(html).toContain('Section 31');
  });
});
