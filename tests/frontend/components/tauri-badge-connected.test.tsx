import { describe, expect, test } from 'bun:test';
import { TauriBadge, isTauriRuntime } from '../../../frontend/src/components/TauriBadge';
import { htmlFor } from '../_render';

describe('TauriBadge connected state', () => {
  test('shows the desktop chip and connected backend status', () => {
    const html = htmlFor(<TauriBadge connected runtime />);
    expect(isTauriRuntime({ __TAURI__: {} } as Window & { __TAURI__: unknown })).toBe(true);
    expect(html).toContain('Desktop');
    expect(html).toContain('connected');
    expect(html).toContain('text-ok-text');
    expect(html).toContain('aria-label="Desktop backend connected"');
  });
});
