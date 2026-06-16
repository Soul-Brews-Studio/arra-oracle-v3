import { describe, expect, test } from 'bun:test';
import { TauriBadge } from '../../../frontend/src/components/TauriBadge';
import { htmlFor } from '../_render';

describe('TauriBadge disconnected state', () => {
  test('shows a red disconnected backend status', () => {
    const html = htmlFor(<TauriBadge connected={false} runtime />);
    expect(html).toContain('Desktop');
    expect(html).toContain('disconnected');
    expect(html).toContain('bg-red-400');
  });
});
