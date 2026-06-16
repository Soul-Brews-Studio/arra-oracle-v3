import { describe, expect, test } from 'bun:test';
import { SearchResultCard } from '../../../frontend/src/components/SearchResultCard';
import { htmlFor } from '../_render';

describe('SearchResultCard render', () => {
  test('renders title, score, preview, and metadata', () => {
    const html = htmlFor(
      <SearchResultCard result={{ id: '1', content: 'Oracle memory', title: 'Finding', score: 0.5, type: 'note', source: 'vault', project: 'arra' }} />,
    );
    expect(html).toContain('Finding');
    expect(html).toContain('50%');
    expect(html).toContain('Oracle memory');
    expect(html).toContain('project: arra');
  });
});
