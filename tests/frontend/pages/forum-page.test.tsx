import { describe, expect, test } from 'bun:test';
import { ForumPage } from '../../../frontend/src/pages/ForumPage';
import { htmlFor } from '../_render';

describe('ForumPage', () => {
  test('renders backend thread rows without truncating long links', () => {
    const html = htmlFor(
      <ForumPage
        loading={false}
        total={1}
        threads={[{
          id: 42,
          title: 'Hosted Studio feed regression discussion with a very long title',
          status: 'active',
          message_count: 3,
          created_at: '2026-07-03T10:00:00.000Z',
          issue_url: 'https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/42',
        }]}
      />,
    );

    expect(html).toContain('Forum threads');
    expect(html).toContain('GET /api/threads?limit=50');
    expect(html).toContain('Thread #42');
    expect(html).toContain('/api/thread/42');
    expect(html).toContain('break-all');
    expect(html).toContain('min-w-0');
  });
});
