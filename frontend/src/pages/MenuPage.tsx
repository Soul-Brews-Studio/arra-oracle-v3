import { useEffect, useMemo, useState } from 'react';
import { apiClient, type ApiClient } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { EmptyState } from '../components/EmptyState';
import type { MenuItem } from '../types';

type PageState = 'loading' | 'ready' | 'error';
type MenuClient = Pick<ApiClient, 'menu'>;

export interface MenuPageProps {
  items?: MenuItem[];
  loading?: boolean;
  client?: MenuClient;
}

function menuKey(item: MenuItem): string {
  return `${item.source ?? 'api'}:${item.sourceName ?? 'core'}:${item.path}:${item.label}`;
}

function menuSource(item: MenuItem): string {
  if (item.sourceName) return `${item.source ?? 'source'}:${item.sourceName}`;
  return item.source ?? 'api';
}

function sortMenuItems(items: MenuItem[]): MenuItem[] {
  return [...items].sort((a, b) =>
    a.group.localeCompare(b.group) ||
    (a.order ?? 999) - (b.order ?? 999) ||
    a.label.localeCompare(b.label)
  );
}

function MenuTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex rounded-full border border-teal-300/20 bg-teal-300/10 px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-teal-100">
      {type}
    </span>
  );
}

function MenuRows({ items }: { items: MenuItem[] }) {
  if (!items.length) return <EmptyState text="No menu items returned from /api/menu." />;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50">
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead className="bg-white/[0.03] text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-4 py-3" scope="col">Name</th>
              <th className="px-4 py-3" scope="col">Type</th>
              <th className="px-4 py-3" scope="col">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {items.map((item) => (
              <tr key={menuKey(item)} className="transition hover:bg-white/[0.03]">
                <td className="px-4 py-4 align-top">
                  <a className="focus-ring font-semibold text-white hover:text-teal-200" href={item.path}>
                    {item.label}
                  </a>
                  <p className="mt-1 font-mono text-xs text-slate-500">{item.path}</p>
                </td>
                <td className="px-4 py-4 align-top">
                  <MenuTypeBadge type={item.group} />
                </td>
                <td className="px-4 py-4 align-top">
                  <p className="font-mono text-xs text-slate-300">{menuSource(item)}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-2 p-3 md:hidden" aria-label="Menu items">
        {items.map((item) => (
          <li key={menuKey(item)} className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a className="focus-ring font-semibold text-white hover:text-teal-200" href={item.path}>
                  {item.label}
                </a>
                <p className="mt-1 truncate font-mono text-xs text-slate-500">{item.path}</p>
              </div>
              <MenuTypeBadge type={item.group} />
            </div>
            <p className="mt-3 font-mono text-xs text-slate-300">{menuSource(item)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MenuPage({ items: initialItems = [], loading, client = apiClient }: MenuPageProps) {
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [state, setState] = useState<PageState>(() =>
    loading || (loading === undefined && !initialItems.length) ? 'loading' : 'ready'
  );
  const [error, setError] = useState('');

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

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="menu-page-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Menu</p>
          <h2 id="menu-page-title" className="mt-2 text-2xl font-semibold text-white">Menu catalog</h2>
          <p className="mt-2 text-sm text-slate-400">All frontend menu rows from GET /api/menu.</p>
        </div>
        <p className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300">
          {state === 'ready' ? `${sortedItems.length} items` : 'Loading items'}
        </p>
      </div>

      {state === 'loading' ? <LoadingPanel title="Loading menu items..." detail="Fetching /api/menu from the Elysia backend." /> : null}
      {state === 'error' ? (
        <ErrorMessage
          title="Could not load menu items."
          message={error || 'The /api/menu request failed.'}
          action={
            <button className="focus-ring rounded-lg border border-red-200/30 px-3 py-2 font-semibold text-red-50 hover:bg-red-200/10" type="button" onClick={() => void loadMenu()}>
              Retry
            </button>
          }
        />
      ) : null}
      {state === 'ready' ? <MenuRows items={sortedItems} /> : null}
    </section>
  );
}
