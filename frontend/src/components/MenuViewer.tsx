import type { MenuItem } from '../types';
import { EmptyState } from './EmptyState';

function groupMenu(items: MenuItem[]) {
  return items.reduce<Record<string, MenuItem[]>>((groups, item) => {
    const key = item.group ?? 'tools';
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {});
}

export function MenuViewer({ items }: { items: MenuItem[] }) {
  const groups = groupMenu(items);
  const orderedGroups = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  if (!items.length) return <EmptyState text="No menu items returned from /api/menu." />;

  return (
    <div className="space-y-5">
      {orderedGroups.map((group) => (
        <section key={group} aria-labelledby={`menu-${group}`}>
          <h3 id={`menu-${group}`} className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-text-muted">
            {group}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {[...groups[group]]
              .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
              .map((item) => (
                <a
                  key={`${item.path}-${item.label}`}
                  href={item.path}
                  className="focus-ring rounded-xl border border-border bg-surface p-4 transition hover:border-accent-border hover:bg-field"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-text">{item.label}</p>
                      <p className="mt-1 font-mono text-xs text-accent">{item.path}</p>
                    </div>
                    <span className="rounded-full bg-surface-muted px-2 py-1 text-xs text-text-muted">#{item.order ?? 999}</span>
                  </div>
                  <p className="mt-3 text-xs text-text-muted">
                    {item.sourceName ? `${item.source ?? 'source'}:${item.sourceName}` : item.source ?? 'route'}
                  </p>
                </a>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
