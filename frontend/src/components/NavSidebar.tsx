import { NavLink } from 'react-router-dom';

export type NavItem = {
  to: string;
  label: string;
  description: string;
  badge?: string | number;
};

function navClass({ isActive }: { isActive: boolean }) {
  const base = 'focus-ring rounded-2xl border px-4 py-3 text-left transition';
  if (isActive) return `${base} border-teal-300/40 bg-teal-300/10 text-white shadow-lg shadow-teal-950/20`;
  return `${base} border-white/10 bg-white/[0.03] text-slate-300 hover:border-teal-300/30 hover:bg-slate-900`;
}

export function NavSidebar({ items }: { items: NavItem[] }) {
  return (
    <aside className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
      <div className="flex h-full flex-col gap-5 rounded-3xl border border-white/10 bg-slate-950/80 p-4 shadow-2xl shadow-black/20">
        <NavLink to="/menu" className="focus-ring rounded-2xl p-2">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-teal-300">Arra Oracle</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Control Surface</h1>
          <p className="mt-2 text-sm text-slate-500">React routes over the Elysia API.</p>
        </NavLink>

        <nav aria-label="Frontend sections" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold">{item.label}</span>
                {item.badge !== undefined ? (
                  <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-300">{item.badge}</span>
                ) : null}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  );
}
