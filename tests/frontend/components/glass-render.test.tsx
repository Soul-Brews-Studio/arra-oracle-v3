import { describe, expect, test } from 'bun:test';
import { Glass } from '../../../frontend/src/components/Glass';
import { htmlFor } from '../_render';

describe('Glass', () => {
  test('renders a rounded glass wrapper with custom classes', () => {
    const html = htmlFor(<Glass className="p-4">Panel</Glass>);
    expect(html).toContain('class="glass rounded-2xl p-4"');
    expect(html).toContain('Panel');
  });
});
