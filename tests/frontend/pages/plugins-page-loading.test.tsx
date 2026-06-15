import { describe, expect, test } from 'bun:test';
import { PluginsPage } from '../../../frontend/src/pages/PluginsPage';
import { htmlFor } from '../_render';

describe('PluginsPage loading state', () => {
  test('shows a loading panel while plugin manifests load', () => {
    const html = htmlFor(<PluginsPage plugins={[]} loading={true} />);
    expect(html).toContain('Registered plugins');
    expect(html).toContain('Loading plugins…');
  });
});
