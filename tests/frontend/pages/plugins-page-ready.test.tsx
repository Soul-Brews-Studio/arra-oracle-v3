import { describe, expect, test } from 'bun:test';
import { PluginsPage } from '../../../frontend/src/pages/PluginsPage';
import { htmlFor } from '../_render';

describe('PluginsPage ready state', () => {
  test('renders plugin entries when loading is complete', () => {
    const html = htmlFor(<PluginsPage plugins={[{ name: 'echo', file: '', size: 0, modified: 'now' }]} loading={false} />);
    expect(html).toContain('echo');
    expect(html).toContain('metadata');
  });
});
