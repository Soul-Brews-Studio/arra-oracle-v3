import { describe, expect, test } from 'bun:test';
import { Badge } from '../../../frontend/src/components/Badge';
import { EmptyState } from '../../../frontend/src/components/EmptyState';
import { htmlFor } from '../_render';

describe('basic component shells', () => {
  test('renders badge children in the pill container', () => {
    const html = htmlFor(<Badge>Plugin surface</Badge>);

    expect(html).toContain('Plugin surface');
    expect(html).toContain('rounded-full');
    expect(html).toContain('text-ok-text');
  });

  test('renders empty-state text with dashed fallback styling', () => {
    const html = htmlFor(<EmptyState text="No plugins matched the filters." />);

    expect(html).toContain('No plugins matched the filters.');
    expect(html).toContain('border-dashed');
    expect(html).toContain('text-text-muted');
  });
});
