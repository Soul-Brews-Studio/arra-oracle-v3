import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { SearchPage, highlightParts, menuSearchSummary } from '../../../frontend/src/pages/SearchPage';
import { htmlFor } from '../_render';

describe('SearchPage render and interaction edges', () => {
  test('hydrates the search input from route query and enables submit', () => {
    const html = htmlFor(<MemoryRouter initialEntries={['/search?q=Vector']}><SearchPage /></MemoryRouter>);

    expect(html).toContain('aria-label="Menu search form"');
    expect(html).toContain('aria-label="Menu search query"');
    expect(html).toContain('value="Vector"');
    expect(html).not.toContain('disabled="" type="submit"');
  });

  test('summarizes empty, loading, and single-result menu searches', () => {
    expect(menuSearchSummary('idle', '', 0)).toBe('Enter a query to search the menu catalog.');
    expect(menuSearchSummary('loading', 'vector', 0)).toBe('Searching menu for “vector”…');
    expect(menuSearchSummary('ready', 'vector', 1)).toBe('1 menu result for “vector”.');
    expect(highlightParts('Vector vector', 'vec').filter((part) => part.match).map((part) => part.text)).toEqual(['Vec', 'vec']);
  });
});
