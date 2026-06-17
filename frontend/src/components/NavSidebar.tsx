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
  if (isActive) return `${base} border-accent-border bg-accent-soft text-on-accent shadow-lg shadow-slate-900/10 dark:border-accent-border dark:bg-accent-soft dark:text-text dark:shadow-black/20`;
  return `${base} border-border bg-surface text-text hover:border-accent-border hover:bg-field dark:border-border dark:bg-surface-muted dark:text-text-muted dark:hover:border-accent-border dark:hover:bg-field`;
}

export function NavSidebar({ items }: { items: NavItem[] }) {
  return (
    <aside aria-label="Application navigation" className="sticky top-2 z-20 lg:top-4 lg:h-[calc(100vh-2rem)]">
      <div className="flex h-full flex-col gap-4 rounded-3xl border border-border bg-surface p-3 shadow-2xl shadow-slate-900/10 backdrop-blur sm:p-4 dark:border-border dark:bg-surface dark:shadow-black/20">
        <NavLink to="/menu" aria-label="Arra Oracle control surface home" className="focus-ring rounded-2xl p-2">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-accent dark:text-accent">Arra Oracle</p>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-on-accent sm:text-2xl dark:text-text">Control Surface</h1>
          <p className="mt-2 text-sm text-text-muted dark:text-text-muted">React routes over the Elysia API.</p>
        </NavLink>

        <nav aria-label="Frontend sections" className="grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 lg:grid-flow-row lg:grid-cols-1 lg:overflow-visible lg:pb-0">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} aria-label={`${item.label}: ${item.description}`} className={navClass}>
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold">{item.label}</span>
                {item.badge !== undefined ? (
                  <span className="rounded-full bg-surface-muted px-2 py-1 text-xs text-text-muted dark:bg-surface-muted dark:text-text-muted">{item.badge}</span>
                ) : null}
              </span>
              <span className="mt-1 block text-xs leading-5 text-text-muted dark:text-text-muted">{item.description}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  );
}
