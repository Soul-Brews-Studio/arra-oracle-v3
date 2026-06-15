import { describe, expect, test } from 'bun:test';
import { StatCard } from '../../../frontend/src/components/StatCard';
import { htmlFor } from '../_render';

describe('StatCard render', () => {
  test('renders a label, value, and detail string', () => {
    const html = htmlFor(<StatCard label="Plugins" value={3} detail="from /api/v1/plugins" />);
    expect(html).toContain('Plugins');
    expect(html).toContain('3');
    expect(html).toContain('from /api/v1/plugins');
  });
});
