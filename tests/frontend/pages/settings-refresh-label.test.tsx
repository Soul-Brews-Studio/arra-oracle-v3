import { describe, expect, test } from 'bun:test';
import { SettingsPage } from '../../../frontend/src/pages/SettingsPage';
import { htmlFor } from '../_render';

describe('SettingsPage refresh label', () => {
  test('labels the runtime settings refresh control', () => {
    const html = htmlFor(<SettingsPage menuCount={0} pluginCount={0} surfaceCount={0} updatedAt="never" onRefresh={() => {}} />);
    expect(html).toContain('aria-label="Refresh runtime settings"');
  });
});
