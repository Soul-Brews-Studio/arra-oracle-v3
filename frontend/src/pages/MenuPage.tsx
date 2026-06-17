import { useEffect, useMemo, useState } from 'react';
import { apiClient, type ApiClient } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { EmptyState } from '../components/EmptyState';
import { menuCatalogPath } from '../routePaths';
import type { MenuItem } from '../types';
import { menuFiltersFromSearch, type MenuFilters } from './menuFilters';

type PageState = 'loading' | 'ready' | 'error';
type MenuClient = Pick<ApiClient, 'menu'>;
export interface MenuPageProps {
  items?: MenuItem[];
  loading?: boolean;
  client?: MenuClient;
  initialSearch?: string;
}

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function menuKey(item: MenuItem): string {
  return `${item.source ?? 'api'}:${item.sourceName ?? 'core'}:${item.path}:${item.label}`;
}

export function menuSource(item: MenuItem): string {
  if (item.sourceName) return `${item.source ?? 'source'}:${item.sourceName}`;
  return item.source ?? 'api';
}

export function sortMenuItems(items: MenuItem[]): MenuItem[] {
  return [...items].sort((a, b) =>
    a.group.localeCompare(b.group) ||
    (a.order ?? 999) - (b.order ?? 999) ||
    a.label.localeCompare(b.label)
  );
}

export function menuFilterOptions(items: MenuItem[]): { groups: string[]; sources: string[] } {
  return {
    groups: [...new Set(items.map((item) => item.group))].sort(),
    sources: [...new Set(items.map(menuSource))].sort(),
  };
}

export function filterMenuItems(items: MenuItem[], filters: MenuFilters): MenuItem[] {
  return items.filter((item) => {
    const groupMatch = filters.group === 'all' || item.group === filters.group;
    const sourceMatch = filters.source === 'all' || menuSource(item) === filters.source;
    return groupMatch && sourceMatch;
  });
}

function MenuTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex rounded-full border border-accent-border px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
      {type}
    </span>
  );
}

function MenuRows({ items, emptyText = 'No menu items returned from /api/menu.' }: { items: MenuItem[]; emptyText?: string }) {
  if (!items.length) return <EmptyState text={emptyText} />;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-field/50">
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead className="bg-surface-muted text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            <tr>
              <th className="px-4 py-3" scope="col">Name</th>
              <th className="px-4 py-3" scope="col">Type</th>
              <th className="px-4 py-3" scope="col">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {items.map((item) => (
              <tr key={menuKey(item)} className="transition hover:bg-surface-muted">
                <td className="px-4 py-4 align-top">
                  <a className="focus-ring font-semibold text-text hover:text-accent" href={item.path}>
                    {item.label}
                  </a>
                  <p className="mt-1 font-mono text-xs text-text-muted">{item.path}</p>
                </td>
                <td className="px-4 py-4 align-top">
                  <MenuTypeBadge type={item.group} />
                </td>
                <td className="px-4 py-4 align-top">
                  <p className="font-mono text-xs text-text-muted">{menuSource(item)}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-2 p-3 md:hidden" aria-label="Menu items">
        {items.map((item) => (
          <li key={menuKey(item)} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a className="focus-ring font-semibold text-text hover:text-accent" href={item.path}>
                  {item.label}
                </a>
                <p className="mt-1 truncate font-mono text-xs text-text-muted">{item.path}</p>
              </div>
              <MenuTypeBadge type={item.group} />
            </div>
            <p className="mt-3 font-mono text-xs text-text-muted">{menuSource(item)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MenuFiltersCard({
  groups,
  sources,
  filters,
  total,
  visible,
  onGroup,
  onSource,
  onClear,
  sharePath,
}: {
  groups: string[];
  sources: string[];
  filters: MenuFilters;
  total: number;
  visible: number;
  onGroup: (value: string) => void;
  onSource: (value: string) => void;
  onClear: () => void;
  sharePath: string;
}) {
  const hasFilters = filters.group !== 'all' || filters.source !== 'all';
  return (
    <section className="mb-5 rounded-2xl border border-border bg-surface-muted p-4" aria-label="Menu filters">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Source filters</p>
          <p className="mt-1 text-sm text-text-muted">Showing {visible} of {total} items across {sources.length} menu sources.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[10rem_minmax(12rem,1fr)_auto]">
          <label className="grid gap-1 text-sm font-medium text-text-muted">
            Group
            <select className="focus-ring rounded-xl border border-border bg-field px-3 py-2 text-text" aria-label="Filter menu group" value={filters.group} onChange={(event) => onGroup(event.currentTarget.value)}>
              <option value="all">All groups</option>
              {groups.map((group) => <option key={group} value={group}>{group}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-text-muted">
            Source
            <select className="focus-ring rounded-xl border border-border bg-field px-3 py-2 text-text" aria-label="Filter menu source" value={filters.source} onChange={(event) => onSource(event.currentTarget.value)}>
              <option value="all">All sources</option>
              {sources.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
          </label>
          <button className="focus-ring self-end rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text hover:border-teal-300/40 disabled:opacity-40" disabled={!hasFilters} type="button" onClick={onClear}>
            Clear
          </button>
          <a className="focus-ring self-end rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent hover:border-accent-border" href={sharePath}>
            Share view
          </a>
        </div>
      </div>
    </section>
  );
}

export function MenuPage({ items: initialItems = [], loading, client = apiClient, initialSearch }: MenuPageProps) {
  const filterDefaults = menuFiltersFromSearch(initialSearch ?? browserSearch());
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [state, setState] = useState<PageState>(() =>
    loading || (loading === undefined && !initialItems.length) ? 'loading' : 'ready'
  );
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<MenuFilters>(filterDefaults);

  async function loadMenu() {
    setState('loading');
    setError('');
    try {
      const response = await client.menu();
      setItems(Array.isArray(response.items) ? response.items : []);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => {
    void loadMenu();
  }, [client]);

  const sortedItems = useMemo(() => sortMenuItems(items), [items]);
  const filterOptions = useMemo(() => menuFilterOptions(sortedItems), [sortedItems]);
  const visibleItems = useMemo(() => filterMenuItems(sortedItems, filters), [filters, sortedItems]);
  const clearFilters = () => setFilters({ group: 'all', source: 'all' });
  const emptyText = sortedItems.length ? 'No menu items match the selected group/source filters.' : undefined;

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="menu-page-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Menu</p>
          <h2 id="menu-page-title" className="mt-2 text-2xl font-semibold text-text">Menu catalog</h2>
          <p className="mt-2 text-sm text-text-muted">All frontend menu rows from GET /api/menu.</p>
        </div>
        <p className="rounded-full border border-border px-3 py-2 text-sm text-text-muted">
          {state === 'ready' ? `${visibleItems.length}/${sortedItems.length} items` : 'Loading items'}
        </p>
      </div>

      {state === 'ready' && sortedItems.length ? (
        <MenuFiltersCard
          groups={filterOptions.groups}
          sources={filterOptions.sources}
          filters={filters}
          total={sortedItems.length}
          visible={visibleItems.length}
          onGroup={(group) => setFilters((current) => ({ ...current, group }))}
          onSource={(source) => setFilters((current) => ({ ...current, source }))}
          onClear={clearFilters}
          sharePath={menuCatalogPath(filters)}
        />
      ) : null}
      {state === 'loading' ? <LoadingPanel title="Loading menu items..." detail="Fetching /api/menu from the Elysia backend." /> : null}
      {state === 'error' ? (
        <ErrorMessage
          title="Could not load menu items."
          message={error || 'The /api/menu request failed.'}
          action={
            <button className="focus-ring rounded-lg border border-err-border px-3 py-2 font-semibold text-err-text hover:bg-err-bg" type="button" onClick={() => void loadMenu()}>
              Retry
            </button>
          }
        />
      ) : null}
      {state === 'ready' ? <MenuRows items={visibleItems} emptyText={emptyText} /> : null}
    </section>
  );
}
