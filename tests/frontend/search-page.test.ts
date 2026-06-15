import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { htmlFor } from './_render';
import {
  MenuSearchResults,
  SearchPage,
  highlightParts,
  menuSearchSummary,
  searchMenuItems,
} from '../../frontend/src/pages/SearchPage';
const result = {
  label: 'Vector Search',
  path: '/vector',
  group: 'tools' as const,
  order: 3,
  source: 'api' as const,
};

describe('frontend SearchPage', () => {
  test('renders the initial full-text menu search form', () => {
    const html = htmlFor(createElement(SearchPage));
    expect(html).toContain('Full-text menu search');
    expect(html).toContain('aria-label="Menu search form"');
    expect(html).toContain('aria-label="Menu search query"');
    expect(html).toContain('/api/menu/search?q=');
  });

  test('summarizes idle, loading, ready, empty, and error states', () => {
    expect(menuSearchSummary('idle', '', 0)).toBe('Enter a query to search the menu catalog.');
    expect(menuSearchSummary('loading', 'vector', 0)).toBe('Searching menu for “vector”…');
    expect(menuSearchSummary('ready', 'vector', 1)).toBe('1 menu result for “vector”.');
    expect(menuSearchSummary('ready', 'missing', 0)).toBe('No menu results found for “missing”.');
    expect(menuSearchSummary('error', 'vector', 0)).toBe('Menu search failed.');
  });

  test('delegates trimmed queries to the menu search API client', async () => {
    let seen = '';
    const response = await searchMenuItems('  vector  ', {
      menuSearch: async (q: string) => {
        seen = q;
        return { data: [result], q, total: 1 };
      },
    });

    expect(seen).toBe('vector');
    expect(response).toMatchObject({ q: 'vector', total: 1 });
  });

  test('renders loading, empty, and highlighted result states', () => {
    const loading = htmlFor(createElement(MenuSearchResults, { query: 'vector', results: [], state: 'loading' }));
    expect(loading).toContain('Searching menu…');
    expect(loading).toContain('/api/menu/search?q=');

    const empty = htmlFor(createElement(MenuSearchResults, { query: 'missing', results: [], state: 'ready' }));
    expect(empty).toContain('No menu results found for “missing”.');

    const ready = htmlFor(createElement(MenuSearchResults, { query: 'search', results: [result], state: 'ready' }));
    expect(ready).toContain('href="/vector"');
    expect(ready).toContain('<mark');
    expect(ready).toContain('Search');
  });

  test('splits highlighted text without regex escaping hazards', () => {
    expect(highlightParts('/api/menu/search?q=', 'SEARCH')).toEqual([
      { text: '/api/menu/', match: false },
      { text: 'search', match: true },
      { text: '?q=', match: false },
    ]);
    expect(highlightParts('Settings', '')).toEqual([{ text: 'Settings', match: false }]);
  });
});
