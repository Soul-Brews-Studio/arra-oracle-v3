import { describe, expect, test } from 'bun:test';
import { isPluginEnabled, pluginStatusLabel, togglePluginEnabled } from '../../../frontend/src/components/PluginList';

describe('PluginList toggle helpers', () => {
  test('derive status from local enable state', () => {
    const plugin = { name: 'canvas', file: '', size: 0, modified: 'now', status: 'ok' };
    const disabled = togglePluginEnabled({ canvas: true }, 'canvas');

    expect(isPluginEnabled(plugin, disabled)).toBe(false);
    expect(pluginStatusLabel(plugin, false)).toBe('disabled');
    expect(pluginStatusLabel(plugin, true)).toBe('ok');
  });
});
