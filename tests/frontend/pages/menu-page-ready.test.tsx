import { describe, expect, test } from 'bun:test';
import { MenuPage } from '../../../frontend/src/pages/MenuPage';
import { htmlFor } from '../_render';

describe('MenuPage ready state', () => {
  test('renders menu rows when loading is complete', () => {
    const html = htmlFor(<MenuPage items={[{ label: 'Vector', path: '/vector', group: 'tools', order: 1, source: 'page' }]} loading={false} />);
    expect(html).toContain('Vector');
    expect(html).toContain('/vector');
    expect(html).toContain('Type');
    expect(html).toContain('Source');
    expect(html).toContain('page');
  });
});
