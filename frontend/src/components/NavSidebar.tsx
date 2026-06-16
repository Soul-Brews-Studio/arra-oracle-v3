import { NavLink } from 'react-router-dom';

export type NavItem = {
  to: string;
  label: string;
  description: string;
  badge?: string | number;
  end?: boolean;
};

function navClass({ isActive }: { isActive: boolean }) {
  const base = 'focus-ring min-w-[10rem] rounded-2xl border px-4 py-3 text-left transition lg:min-w-0';
  if (isActive) return `${base} border-teal-500/50 bg-teal-500/10 text-slate-950 shadow-lg shadow-teal-900/10 dark:border-teal-300/40 dark:bg-teal-300/10 dark:text-white dark:shadow-teal-950/20`;
  return `${base} border-slate-200 bg-white/70 text-slate-700 hover:border-teal-500/40 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-teal-300/30 dark:hover:bg-slate-900`;
}

export function NavSidebar({ items }: { items: NavItem[] }) {
  return (
    <aside aria-label="Application navigation" className="sticky top-2 z-20 lg:top-4 lg:h-[calc(100vh-2rem)]">
      <div className="flex h-full flex-col gap-4 rounded-3xl border border-slate-200 bg-white/90 p-3 shadow-2xl shadow-slate-200/70 backdrop-blur sm:p-4 dark:border-white/10 dark:bg-slate-950/80 dark:shadow-black/20">
        <NavLink to="/menu" aria-label="Arra Oracle control surface home" className="focus-ring rounded-2xl p-2">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-teal-700 dark:text-teal-300">Arra Oracle</p>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl dark:text-white">Control Surface</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-500">React routes over the Elysia API.</p>
        </NavLink>

        <nav aria-label="Frontend sections" className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 lg:grid-flow-row lg:grid-cols-1 lg:overflow-visible lg:pb-0">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} aria-label={`${item.label}: ${item.description}`} className={navClass}>
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold">{item.label}</span>
                {item.badge !== undefined ? (
                  <span className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-600 dark:bg-white/10 dark:text-slate-300">{item.badge}</span>
                ) : null}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-500">{item.description}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  );
}
