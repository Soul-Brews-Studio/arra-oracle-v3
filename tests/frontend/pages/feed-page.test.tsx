import { describe, expect, test } from 'bun:test';
import { FeedPage, feedStatus } from '../../../frontend/src/pages/FeedPage';
import { htmlFor } from '../_render';

describe('FeedPage', () => {
  test('renders DB-backed feed copy and controls', () => {
    const html = htmlFor(<FeedPage load={async () => ({ results: [], total: 0, query: '' })} />);
    expect(html).toContain('Document feed');
    expect(html).toContain('Reads /api/list');
    expect(html).toContain('Refresh');
  });

  test('status reflects DB/FTS totals', () => {
    expect(feedStatus('ready', 35164, 50)).toBe('Showing 50 of 35164 DB/FTS documents.');
  });
});
