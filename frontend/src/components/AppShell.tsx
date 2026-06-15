import type { ReactNode } from 'react';
import { NavSidebar, type NavItem } from './NavSidebar';
import { StatCard } from './StatCard';

type AppShellProps = {
  children: ReactNode;
  error: string;
  loading: boolean;
  menuCount: number;
  pluginCount: number;
  surfaceCount: number;
  updatedAt: string;
  onRefresh: () => void;
};

export function AppShell({
  children,
  error,
  loading,
  menuCount,
  pluginCount,
  surfaceCount,
  updatedAt,
  onRefresh,
}: AppShellProps) {
  const navItems: NavItem[] = [
    { to: '/menu', label: 'Menu', description: 'Navigation rows from /api/menu', badge: loading ? '…' : menuCount },
    { to: '/plugins', label: 'Plugins', description: 'Registered plugins and surfaces', badge: loading ? '…' : pluginCount },
    { to: '/vector', label: 'Vector', description: 'Semantic search over memory' },
    { to: '/mcp', label: 'MCP', description: 'Tool schemas and groups' },
    { to: '/settings', label: 'Settings', description: 'Frontend/API runtime notes' },
  ];

  return (
    <main className="oracle-shell min-h-screen text-slate-100">
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[18rem_1fr] lg:px-8">
        <NavSidebar items={navItems} />
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/30 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.28em] text-teal-300">Frontend UI</p>
              <h2 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">Operational dashboard</h2>
              <p className="mt-3 max-w-2xl text-slate-400">
                Routed menu, plugin, vector, MCP, and settings pages over the Vite `/api/*` proxy.
              </p>
            </div>
            <button
              className="focus-ring rounded-xl bg-teal-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-teal-200"
              type="button"
              onClick={onRefresh}
            >
              Refresh data
            </button>
          </header>

          <section className="grid gap-4 md:grid-cols-3" aria-label="Summary">
            <StatCard label="Menu items" value={loading ? '…' : menuCount} detail="from /api/menu" />
            <StatCard label="Plugins" value={loading ? '…' : pluginCount} detail="from /api/plugins" />
            <StatCard label="Surfaces" value={loading ? '…' : surfaceCount} detail={`updated ${updatedAt}`} />
          </section>

          {error ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-950/40 p-4 text-red-100">
              <p className="font-semibold">Could not load backend data.</p>
              <p className="mt-1 text-sm text-red-200/80">{error}</p>
            </div>
          ) : null}

          {children}
        </div>
      </div>
    </main>
  );
}
