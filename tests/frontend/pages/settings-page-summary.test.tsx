import { describe, expect, test } from 'bun:test';
import { SettingsPage } from '../../../frontend/src/pages/SettingsPage';
import { htmlFor } from '../_render';

describe('SettingsPage summary', () => {
  test('renders frontend counts and route metadata while settings load', () => {
    const html = htmlFor(<SettingsPage menuCount={3} pluginCount={2} surfaceCount={5} updatedAt="11:11" onRefresh={() => {}} />);
    expect(html).toContain('Runtime configuration');
    expect(html).toContain('3 menu · 2 plugins');
    expect(html).toContain('Plugin surfaces');
    expect(html).toContain('/ /plugins /metrics /search');
  });
});
