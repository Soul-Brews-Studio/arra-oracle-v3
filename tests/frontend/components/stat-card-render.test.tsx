import { describe, expect, test } from 'bun:test';
import { StatCard } from '../../../frontend/src/components/StatCard';
import { htmlFor } from '../_render';

describe('StatCard render', () => {
  test('renders semantic article chrome with a label, value, and detail string', () => {
    const html = htmlFor(<StatCard label="Plugins" value={3} detail="from /api/plugins" tone="success" trend="+2" />);
    expect(html).toContain('<article');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('glass glass-hover');
    expect(html).toContain('transition-[background-color,border-color,box-shadow]');
    expect(html).toContain('border-ok-border');
    expect(html).not.toContain('bg-surface-muted');
    expect(html).toContain('Plugins');
    expect(html).toContain('3');
    expect(html).toContain('+2');
    expect(html).toContain('from /api/plugins');
  });
});
