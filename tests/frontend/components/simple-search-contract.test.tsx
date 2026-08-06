import { describe, expect, test } from 'bun:test';
import {
  SIMPLE_SEARCH_DEBOUNCE_MS,
  SIMPLE_SEARCH_EMPTY,
  SIMPLE_SEARCH_EXAMPLES,
  SimpleSearch,
  simpleSearchStatus,
  visibleSimpleResults,
  type SimpleSearchClient,
} from '../../../frontend/src/components/simple/SimpleSearch';
import { htmlFor } from '../_render';
import type { VectorSearchResponse } from '../../../src/server/types';

const client: SimpleSearchClient = {
  vectorSearch: async (): Promise<VectorSearchResponse> => ({ results: [], total: 0, query: 'x' }),
};

const result = (id: number) => ({
  id: `r${id}`,
  type: 'learning',
  content: `content ${id}`,
  source_file: `notes/${id}.md`,
  concepts: [],
});

describe('SimpleSearch contract', () => {
  test('renders type=search input, visible button, and three example chips', () => {
    const html = htmlFor(<SimpleSearch client={client} />);

    expect(html).toContain('aria-label="Simple search form"');
    expect(html).toContain('aria-label="Simple search query"');
    expect(html).toContain('type="search"');
    expect(html).toContain('h-12');
    expect(html).toContain('h-11');
    expect(html).toContain('Search</button>');
    for (const example of SIMPLE_SEARCH_EXAMPLES) expect(html).toContain(example);
    expect(SIMPLE_SEARCH_EXAMPLES).toHaveLength(3);
  });

  test('uses a 600ms debounce and caps inline results at five', () => {
    expect(SIMPLE_SEARCH_DEBOUNCE_MS).toBe(600);
    expect(visibleSimpleResults(Array.from({ length: 7 }, (_, i) => result(i)))).toHaveLength(5);
  });

  test('never returns blank status copy for zero results', () => {
    expect(simpleSearchStatus('ready', 'missing', 0)).toBe(SIMPLE_SEARCH_EMPTY);
    expect(simpleSearchStatus('idle', '', 0)).not.toBe('');
    expect(simpleSearchStatus('error', 'missing', 0)).not.toBe('');
  });
});
