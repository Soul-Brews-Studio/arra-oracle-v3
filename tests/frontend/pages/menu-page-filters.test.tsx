import { describe, expect, test } from 'bun:test';
import {
  filterMenuItems,
  menuFilterOptions,
  MenuPage,
  menuSource,
} from '../../../frontend/src/pages/MenuPage';
import { menuFiltersFromSearch } from '../../../frontend/src/pages/menuFilters';
import type { MenuItem } from '../../../frontend/src/types';
import { htmlFor } from '../_render';

const items: MenuItem[] = [
  { label: 'Echo', path: '/plugins/echo', group: 'tools', order: 20, source: 'plugin', sourceName: 'echo' },
  { label: 'Settings', path: '/settings', group: 'admin', order: 10, source: 'frontend' },
  { label: 'Docs', path: '/docs', group: 'main', order: 5, source: 'gist', sourceName: 'handbook' },
];

describe('MenuPage filters', () => {
  test('derives source labels and filter options from menu rows', () => {
    expect(menuSource(items[0])).toBe('plugin:echo');
    expect(menuFilterOptions(items)).toEqual({
      groups: ['admin', 'main', 'tools'],
      sources: ['frontend', 'gist:handbook', 'plugin:echo'],
    });
  });

  test('filters menu rows by group and source', () => {
    const visible = filterMenuItems(items, { group: 'tools', source: 'plugin:echo' });
    expect(visible.map((item) => item.label)).toEqual(['Echo']);
    expect(filterMenuItems(items, { group: 'admin', source: 'plugin:echo' })).toEqual([]);
  });

  test('hydrates menu filters from shareable route search params', () => {
    expect(menuFiltersFromSearch('?group=tools&source=plugin%3Aecho')).toEqual({ group: 'tools', source: 'plugin:echo' });
    expect(menuFiltersFromSearch('?group=&source=')).toEqual({ group: 'all', source: 'all' });

    const html = htmlFor(<MenuPage items={items} loading={false} initialSearch="?group=tools&source=plugin%3Aecho" />);
    expect(html).toContain('1/3 items');
    expect(html).toContain('value="tools" selected');
    expect(html).toContain('value="plugin:echo" selected');
    expect(html).toContain('href="/menu?group=tools&amp;source=plugin%3Aecho"');
  });

  test('renders menu filter controls with plugin sources', () => {
    const html = htmlFor(<MenuPage items={items} loading={false} />);
    expect(html).toContain('aria-label="Menu filters"');
    expect(html).toContain('aria-label="Filter menu group"');
    expect(html).toContain('aria-label="Filter menu source"');
    expect(html).toContain('plugin:echo');
    expect(html).toContain('3/3 items');
  });
});
