import { describe, expect, test } from 'bun:test';
import { GlobalSearchResults } from '../../../frontend/src/components/GlobalSearch';
import { htmlFor } from '../_render';

describe('GlobalSearchResults empty state', () => {
  test('renders an empty state for unified searches with no matches', () => {
    expect(htmlFor(<GlobalSearchResults results={[]} />)).toContain('No matching menu, plugin, or MCP tool surfaces.');
  });
});
