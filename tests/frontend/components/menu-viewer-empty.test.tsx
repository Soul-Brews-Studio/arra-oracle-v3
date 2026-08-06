import { describe, expect, test } from 'bun:test';
import { MenuViewer } from '../../../frontend/src/components/MenuViewer';
import { htmlFor } from '../_render';

describe('MenuViewer empty state', () => {
  test('renders an empty state when no menu rows are returned', () => {
    expect(htmlFor(<MenuViewer items={[]} />)).toContain('No menu items returned from /api/menu.');
  });
});
