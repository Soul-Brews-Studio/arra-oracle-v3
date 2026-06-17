import { describe, expect, test } from 'bun:test';
import { GlobalSearchResults } from '../../../frontend/src/components/GlobalSearch';
import { htmlFor } from '../_render';

describe('GlobalSearchResults empty state', () => {
  test('renders an empty state for unified searches with no matches', () => {
    const html = htmlFor(<GlobalSearchResults results={[]} />);

    expect(html).toContain('No matching surfaces.');
    expect(html).toContain('border-warn-border bg-warn-bg text-warn-text');
    expect(html).toContain('role="status"');
  });
});
