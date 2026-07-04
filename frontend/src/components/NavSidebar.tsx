import { NavLink } from 'react-router-dom';

export type NavItem = {
  to: string;
  label: string;
  description: string;
  badge?: string | number;
  end?: boolean;
};

type NavGroup = {
  label: string;
  paths: string[];
};

const navGroups: NavGroup[] = [
  { label: 'Core', paths: ['/', '/plugins', '/status'] },
  { label: 'Search', paths: ['/search', '/feed'] },
  { label: 'Knowledge', paths: ['/memory', '/learn', '/forum', '/activity', '/traces'] },
  { label: 'Vector', paths: ['/vector', '/vector/documents', '/vector/index', '/vector/first-run', '/vector/search', '/vector/settings', '/vector/export'] },
  { label: 'System', paths: ['/mcp', '/canvas', '/canvas/plugins', '/metrics', '/storage', '/settings', '/export'] },
];

function itemPath(item: NavItem): string {
  return item.to.split(/[?#]/)[0] || '/';
}

function groupedItems(items: NavItem[]): Array<{ label: string; items: NavItem[] }> {
  const indexed = items.map((item, index) => ({ item, index, path: itemPath(item) }));
  const used = new Set<NavItem>();
  const groups = navGroups.flatMap((group) => {
    const entries = indexed
      .filter((entry) => group.paths.includes(entry.path))
      .sort((left, right) => group.paths.indexOf(left.path) - group.paths.indexOf(right.path) || left.index - right.index);
    entries.forEach((entry) => used.add(entry.item));
    return entries.length ? [{ label: group.label, items: entries.map((entry) => entry.item) }] : [];
  });
  const other = items.filter((item) => !used.has(item));
  return other.length ? [...groups, { label: 'Other', items: other }] : groups;
}

function navClass({ isActive }: { isActive: boolean }) {
  const base = 'focus-ring min-w-[10rem] rounded-2xl border border-l-2 px-4 py-3 text-left transition-all duration-200 hover:bg-[oklch(1_0_0/0.06)] hover:shadow-[0_0_12px_oklch(0.82_0.13_178/0.1)] lg:min-w-0';
  if (isActive) return `${base} border-accent bg-accent-soft text-accent shadow-[0_0_16px_oklch(0.82_0.13_178/0.14)]`;
  return `${base} border-[oklch(1_0_0/0.06)] border-l-transparent bg-transparent text-text hover:border-accent-border`;
}

export function NavSidebar({ items }: { items: NavItem[] }) {
  const groups = groupedItems(items);
  return (
    <aside aria-label="Application navigation" className="z-20 min-w-0 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:max-h-[calc(100dvh-2rem)]">
      <div className="glass flex min-w-0 flex-col gap-4 overflow-hidden rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] p-3 shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl sm:p-4 lg:h-[calc(100vh-2rem)] lg:max-h-[calc(100dvh-2rem)]">
        <NavLink to="/menu" aria-label="Arra Oracle control surface home" className="focus-ring min-w-0 rounded-2xl p-2">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-accent">Arra Oracle</p>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-text sm:text-2xl">Control Surface</h1>
          <p className="mt-2 text-sm text-text-muted">React routes over the Elysia API.</p>
        </NavLink>

        <nav aria-label="Frontend sections" className="hide-scrollbar flex min-w-0 max-w-full gap-3 overflow-x-auto pb-1 lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:overscroll-contain lg:pb-0">
          {groups.map((group) => (
            <section key={group.label} aria-label={`${group.label} navigation`} className="grid min-w-[12rem] gap-2 lg:min-w-0">
              <p className="px-2 text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-text-muted">{group.label}</p>
              <div className="grid gap-2">
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} aria-label={`${item.label}: ${item.description}`} className={navClass}>
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{item.label}</span>
                      {item.badge !== undefined ? (
                        <span className="rounded-full bg-surface-muted px-2 py-1 text-xs text-text-muted" aria-label={`${item.badge} items`}>{item.badge}</span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-text-muted">{item.description}</span>
                  </NavLink>
                ))}
              </div>
            </section>
          ))}
        </nav>
      </div>
    </aside>
  );
}
