import { describe, expect, test } from 'bun:test';
import { TauriBadge } from '../../../frontend/src/components/TauriBadge';
import { htmlFor } from '../_render';

describe('TauriBadge disconnected state', () => {
  test('shows a semantic danger disconnected backend status', () => {
    const html = htmlFor(<TauriBadge connected={false} runtime />);
    expect(html).toContain('Desktop');
    expect(html).toContain('disconnected');
    expect(html).toContain('text-err-text');
    expect(html).toContain('aria-label="Desktop backend disconnected"');
  });
});
