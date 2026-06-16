import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorMessage, Spinner } from './AsyncState';
import { NavSidebar, type NavItem } from './NavSidebar';
import { routeMeta } from '../routeMeta';
import { PageChrome } from './PageChrome';
import { StatCard } from './StatCard';
import { CommandPalette } from './CommandPalette';
import { ThemeToggle } from './ThemeToggle';
import { GlobalSearch } from './GlobalSearch';
import type { MetricsSnapshot } from '../../../src/server/types';

type AppShellProps = {
  children: ReactNode;
  error: string;
  loading: boolean;
  menuCount: number;
  pluginCount: number;
  surfaceCount: number;
  metrics?: MetricsSnapshot | null;
  metricsLoading?: boolean;
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
  metrics = null,
  metricsLoading = false,
  updatedAt,
  onRefresh,
}: AppShellProps) {
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const meta = useMemo(() => routeMeta(location.pathname, location.search), [location.pathname, location.search]);

  useEffect(() => {
    document.title = `${meta.title} · Arra Oracle`;
  }, [meta.title]);

  useEffect(() => {
    contentRef.current?.focus({ preventScroll: true });
  }, [location.pathname, location.search]);

  const navItems: NavItem[] = [
    { to: '/', label: 'Menu', description: 'Navigation rows from /api/menu', badge: loading ? '…' : menuCount },
    { to: '/plugins', label: 'Plugins', description: 'Registered plugins and surfaces', badge: loading ? '…' : pluginCount },
    { to: '/canvas/plugins', label: 'Canvas Plugins', description: 'Canvas registry from /api/canvas/plugins' },
    { to: '/search', label: 'Search', description: 'Full-text menu search' },
    { to: '/vector', label: 'Vector Dashboard', description: 'Collection health and indexing', end: true },
    { to: '/vector/documents', label: 'Document Browser', description: 'Browse indexed vector documents' },
    { to: '/vector/search', label: 'Vector Search', description: 'Semantic preview by collection' },
    { to: '/vector/settings', label: 'Vector settings', description: 'Collection config and index controls' },
    { to: '/vector/export', label: 'Export', description: 'Download vector collections' },
    { to: '/learn', label: 'Learn', description: 'Create and edit learnings' },
    { to: '/metrics', label: 'Metrics', description: 'Runtime counters from /api/v1/metrics' },
    { to: '/mcp', label: 'MCP', description: 'Tool schemas and groups' },
    { to: '/settings', label: 'Settings', description: 'Storage, embedder, and DB status' },
  ];
  const requestValue = metricsLoading ? <Spinner label="Loading metrics" /> : metrics?.requestCount ?? '—';
  const responseValue = metricsLoading ? <Spinner label="Loading metrics" /> : `${metrics?.avgResponseMs ?? 0} ms`;
  const metricsDetail = metrics
    ? `${metrics.activeConnections} active · uptime ${Math.round(metrics.uptime)}s`
    : 'from /api/v1/metrics';
  const retry = (
    <button
      aria-label="Retry loading backend dashboard data"
      className="focus-ring rounded-lg border border-red-200/30 px-3 py-2 font-semibold text-red-50 hover:bg-red-200/10"
      type="button"
      onClick={onRefresh}
    >
      Retry
    </button>
  );

  return (
    <main className="oracle-shell min-h-screen text-slate-900 transition-colors dark:text-slate-100">
      <a
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-teal-300 focus:px-4 focus:py-3 focus:font-semibold focus:text-slate-950"
        href="#main-content"
      >
        Skip to main content
      </a>
      <div className="mx-auto grid w-full max-w-7xl gap-4 px-3 py-3 sm:gap-6 sm:px-6 sm:py-6 lg:grid-cols-[18rem_1fr] lg:px-8">
        <NavSidebar items={navItems} />
        <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
          <header className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-2xl shadow-slate-200/60 backdrop-blur sm:p-6 lg:flex-row lg:items-end lg:justify-between dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/30">
            <PageChrome meta={meta} />
            <div className="grid w-full gap-3 lg:max-w-md">
              <CommandPalette onRefresh={onRefresh} />
              <GlobalSearch />
              <div className="grid gap-3 sm:flex sm:items-center sm:justify-end">
                <ThemeToggle />
                <button
                  className="focus-ring rounded-xl bg-teal-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loading}
                  type="button"
                  onClick={onRefresh}
                >
                  {loading ? <Spinner label="Refreshing" /> : 'Refresh data'}
                </button>
              </div>
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5" aria-label="Summary">
            <StatCard label="Menu items" value={loading ? <Spinner label="Loading" /> : menuCount} detail="from /api/menu" />
            <StatCard label="Plugins" value={loading ? <Spinner label="Loading" /> : pluginCount} detail="from /api/plugins" />
            <StatCard label="Surfaces" value={loading ? <Spinner label="Loading" /> : surfaceCount} detail={`updated ${updatedAt}`} />
            <StatCard label="Requests" value={requestValue} detail={metricsDetail} />
            <StatCard label="Avg response" value={responseValue} detail="real-time backend latency" />
          </section>

          {error ? <ErrorMessage title="Could not load backend data." message={error} action={retry} /> : null}
          <div id="main-content" ref={contentRef} tabIndex={-1} className="focus:outline-none">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
