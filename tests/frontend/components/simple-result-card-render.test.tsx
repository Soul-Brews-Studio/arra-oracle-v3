import { describe, expect, test } from 'bun:test';
import { SimpleResultCard, simpleResultPreview, simpleResultTitle } from '../../../frontend/src/components/simple/SimpleResultCard';
import { htmlFor } from '../_render';
import type { VectorSearchResponse } from '../../../src/server/types';

type Result = VectorSearchResponse['results'][number];

const result: Result = {
  id: 'doc-1',
  type: 'learning',
  source_file: 'mine/notes/oracle.md',
  content: 'Oracle memory keeps useful deployment notes. '.repeat(8),
  concepts: ['oracle', 'deploy', 'notes', 'extra'],
  score: 0.87,
  model: 'bge-m3',
};

describe('SimpleResultCard', () => {
  test('renders collapsed preview with an expand-in-place button', () => {
    const html = htmlFor(<SimpleResultCard result={result} />);

    expect(html).toContain('Search result mine/notes/oracle.md');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Show result');
    expect(html).toContain('87%');
    expect(html).toContain('oracle');
    expect(html).not.toContain('extra');
  });

  test('can render expanded content in place', () => {
    const html = htmlFor(<SimpleResultCard result={result} defaultExpanded />);

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Hide details');
    expect(html).toContain(result.content);
  });

  test('normalizes result title and preview fallbacks', () => {
    expect(simpleResultTitle(result)).toBe('mine/notes/oracle.md');
    expect(simpleResultPreview('')).toBe('No preview available.');
    expect(simpleResultPreview('x'.repeat(220))).toEndWith('…');
  });
});
