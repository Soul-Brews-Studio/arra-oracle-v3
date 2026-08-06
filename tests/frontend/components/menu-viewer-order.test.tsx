import { describe, expect, test } from 'bun:test';
import { MenuViewer } from '../../../frontend/src/components/MenuViewer';
import { htmlFor } from '../_render';

describe('MenuViewer ordering', () => {
  test('sorts menu rows by their order within each group', () => {
    const html = htmlFor(
      <MenuViewer
        items={[
          { label: 'Second', path: '/second', group: 'tools', order: 20 },
          { label: 'First', path: '/first', group: 'tools', order: 1 },
        ]}
      />,
    );
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'));
  });
});
