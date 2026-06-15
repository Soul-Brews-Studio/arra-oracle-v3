import { describe, expect, test } from 'bun:test';
import { toolMode } from '../../../frontend/src/components/toolView';

describe('toolMode', () => {
  test('labels read-only, write, and unspecified tools', () => {
    expect(toolMode({ name: 'a', description: '', readOnly: true })).toBe('read-only');
    expect(toolMode({ name: 'b', description: '', readOnly: false })).toBe('write');
    expect(toolMode({ name: 'c', description: '' })).toBe('unspecified');
  });
});
