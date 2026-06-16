import { describe, expect, test } from 'bun:test';
import { PluginList } from '../../../frontend/src/components/PluginList';
import { htmlFor } from '../_render';

describe('PluginList empty state', () => {
  test('renders an empty state when no plugins are registered', () => {
    expect(htmlFor(<PluginList plugins={[]} />)).toContain('No plugins registered in /api/plugins.');
  });
});
