import { describe, expect, test } from 'bun:test';
import { MenuPage } from '../../../frontend/src/pages/MenuPage';
import { htmlFor } from '../_render';

describe('MenuPage loading state', () => {
  test('shows a loading panel while menu rows load', () => {
    const html = htmlFor(<MenuPage items={[]} loading={true} />);
    expect(html).toContain('Menu catalog');
    expect(html).toContain('Loading menu items...');
  });
});
