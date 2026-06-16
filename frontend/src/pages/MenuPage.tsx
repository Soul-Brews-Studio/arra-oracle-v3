import { useEffect, useMemo, useState } from 'react';
import { LoadingPanel } from '../components/AsyncState';
import { MenuViewer } from '../components/MenuViewer';
import type { MenuItem } from '../types';

interface MenuHistoryEntry {
  label: string;
  path: string;
  seenAt: number;
}

const historyStorageKey = 'arra-oracle:menu-command-history';

function parseHistory(raw: string | null): MenuHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is MenuHistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as MenuHistoryEntry).label === 'string' &&
        typeof (entry as MenuHistoryEntry).path === 'string' &&
        typeof (entry as MenuHistoryEntry).seenAt === 'number'
      )
      .slice(0, 5)
      .sort((a, b) => b.seenAt - a.seenAt);
  } catch {
    return [];
  }
}

function readRecentHistory(): MenuHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  return parseHistory(window.localStorage.getItem(historyStorageKey));
}

function topByOrder(items: MenuItem[]) {
  return [...items]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 6);
}

function formatAction(item: MenuItem) {
  return `${item.label} • ${item.path}`;
}

export function MenuPage({ items, loading }: { items: MenuItem[]; loading: boolean }) {
  const quickItems = useMemo(() => topByOrder(items), [items]);
  const recentCommands = useMemo(() => topByOrder(items).slice(0, 3), [items]);
  const [history, setHistory] = useState<MenuHistoryEntry[]>([]);

  useEffect(() => {
    setHistory(readRecentHistory());
  }, []);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="menu-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Menu</p>
      <h2 id="menu-page-title" className="mt-2 mb-4 text-2xl font-semibold text-white">Menu viewer</h2>
      {loading ? (
        <LoadingPanel title="Loading menu items…" detail="Fetching /api/menu from the Elysia backend." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Quick access</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Frequently used items</h3>
            <p className="mt-2 text-sm text-slate-400">One-click links to surfaces you reach most often.</p>
            <div className="mt-4 grid gap-3">
              {quickItems.length ? quickItems.map((item) => (
                <a key={`quick-${item.path}-${item.label}`} href={item.path} className="focus-ring rounded-xl border border-white/10 bg-slate-950 p-3 text-sm text-slate-200 transition hover:border-teal-300/40 hover:bg-slate-900">
                  <p className="font-medium text-white">{item.label}</p>
                  <p className="mt-1 font-mono text-xs text-teal-200">{item.path}</p>
                </a>
              )) : <p className="text-sm text-slate-400">No menu items yet.</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Recent commands</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Actions as cards</h3>
            <p className="mt-2 text-sm text-slate-400">Recent navigation and action targets in a compact card grid.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {recentCommands.length ? recentCommands.map((item) => (
                <article key={`recent-${item.path}-${item.label}`} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                  <p className="font-medium text-white">{item.label}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatAction(item)}</p>
                  <a href={item.path} className="mt-3 inline-flex text-xs text-teal-300 transition hover:text-teal-200">Open route</a>
                </article>
              )) : <p className="text-sm text-slate-400">No commands yet.</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-4 xl:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Command history</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Menu command history</h3>
            <p className="mt-2 text-sm text-slate-400">Recent command executions captured during this browser session.</p>
            {history.length ? (
              <ul className="mt-4 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
                {history.map((entry) => (
                  <li key={`${entry.path}-${entry.seenAt}`} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2">
                    <span className="font-mono text-teal-200">{entry.path}</span>
                    <p className="text-xs text-slate-400">{entry.label}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-400">No command history yet. Use a menu action to begin tracking.</p>
            )}
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-4 xl:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">All commands</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Menu catalog</h3>
            <MenuViewer items={items} />
          </section>
        </div>
      )}
    </section>
  );
}
