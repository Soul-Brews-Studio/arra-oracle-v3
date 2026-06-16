import { describe, expect, test } from 'bun:test';
import { PluginList } from '../../../frontend/src/components/PluginList';
import { htmlFor } from '../_render';

const plugin = { name: 'metadata-only', file: '', size: 0, modified: 'now', status: 'disabled' };

describe('PluginList admin a11y edges', () => {
  test('labels enable actions and metadata fallback surfaces for disabled plugins', () => {
    const html = htmlFor(<PluginList plugins={[plugin]} />);

    expect(html).toContain('aria-label="Enable metadata-only"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('inactive');
    expect(html).toContain('server-only');
    expect(html).toContain('href="/plugins?q=metadata-only&amp;surface=metadata"');
  });

  test('honors local enabled state overrides for assistive labels', () => {
    const html = htmlFor(<PluginList plugins={[plugin]} enabledState={{ 'metadata-only': true }} />);

    expect(html).toContain('aria-label="Disable metadata-only"');
    expect(html).toContain('aria-pressed="true"');
  });
});
