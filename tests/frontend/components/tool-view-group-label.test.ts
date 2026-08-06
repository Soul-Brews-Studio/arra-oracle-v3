import { describe, expect, test } from 'bun:test';
import { groupLabel } from '../../../frontend/src/components/toolView';

describe('groupLabel', () => {
  test('prefers group, then plugin, then the MCP default', () => {
    expect(groupLabel({ name: 'a', description: '', group: 'core' })).toBe('core');
    expect(groupLabel({ name: 'b', description: '', plugin: 'echo' })).toBe('plugin:echo');
    expect(groupLabel({ name: 'c', description: '' })).toBe('mcp');
  });
});
