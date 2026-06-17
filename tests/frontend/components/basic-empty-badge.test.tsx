import { describe, expect, test } from 'bun:test';
import { Badge, badgeToneForStatus } from '../../../frontend/src/components/Badge';
import { EmptyState } from '../../../frontend/src/components/EmptyState';
import { htmlFor } from '../_render';

describe('basic component shells', () => {
  test('renders badge children with semantic token tones and optional status dot', () => {
    const html = htmlFor(<Badge dot tone="success">Plugin surface</Badge>);

    expect(html).toContain('Plugin surface');
    expect(html).toContain('rounded-full');
    expect(html).toContain('text-ok-text');
    expect(html).toContain('bg-current');
    expect(badgeToneForStatus('degraded')).toBe('warning');
    expect(badgeToneForStatus('down')).toBe('danger');
  });

  test('renders empty-state text with announced dashed fallback styling', () => {
    const html = htmlFor(<EmptyState text="No plugins matched the filters." />);

    expect(html).toContain('role="status"');
    expect(html).toContain('No plugins matched the filters.');
    expect(html).toContain('border-dashed');
    expect(html).toContain('bg-surface-muted');
  });
});
