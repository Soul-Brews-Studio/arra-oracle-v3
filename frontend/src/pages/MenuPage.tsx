import { LoadingPanel } from '../components/AsyncState';
import { MenuViewer } from '../components/MenuViewer';
import type { MenuItem } from '../types';

export function MenuPage({ items, loading }: { items: MenuItem[]; loading: boolean }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="menu-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Menu</p>
      <h2 id="menu-page-title" className="mt-2 mb-4 text-2xl font-semibold text-white">Menu viewer</h2>
      {loading ? <LoadingPanel title="Loading menu items…" detail="Fetching /api/menu from the Elysia backend." /> : <MenuViewer items={items} />}
    </section>
  );
}
