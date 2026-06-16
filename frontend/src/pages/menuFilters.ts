export type MenuFilters = { group: string; source: string };

export function menuFiltersFromSearch(search = ''): MenuFilters {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    group: params.get('group')?.trim() || 'all',
    source: params.get('source')?.trim() || 'all',
  };
}
