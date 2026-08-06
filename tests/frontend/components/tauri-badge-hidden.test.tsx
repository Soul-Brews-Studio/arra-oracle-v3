import { describe, expect, test } from 'bun:test';
import { TauriBadge } from '../../../frontend/src/components/TauriBadge';
import { htmlFor } from '../_render';

describe('TauriBadge outside desktop runtime', () => {
  test('renders nothing when window.__TAURI__ is absent', () => {
    expect(htmlFor(<TauriBadge connected runtime={false} />)).toBe('');
  });
});
