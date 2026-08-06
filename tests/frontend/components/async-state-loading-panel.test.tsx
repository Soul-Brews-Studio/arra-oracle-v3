import { describe, expect, test } from 'bun:test';
import { LoadingPanel } from '../../../frontend/src/components/AsyncState';
import { htmlFor } from '../_render';

describe('LoadingPanel', () => {
  test('renders status text and optional detail', () => {
    const html = htmlFor(<LoadingPanel title="Loading settings…" detail="Fetching /api/settings/system." />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading settings…');
    expect(html).toContain('Fetching /api/settings/system.');
  });
});
