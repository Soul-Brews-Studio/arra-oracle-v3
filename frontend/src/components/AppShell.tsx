import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorMessage, Spinner } from './AsyncState';
import { NavSidebar, type NavItem } from './NavSidebar';
import { routeMeta } from '../routeMeta';
import { PageChrome } from './PageChrome';
import { StatCard } from './StatCard';
import { CommandPalette } from './CommandPalette';
import { TauriBadge } from './TauriBadge';
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
  const routeKey = `${location.pathname}${location.search}`;
  const lastFocusedRouteRef = useRef(routeKey);
  const meta = useMemo(() => routeMeta(location.pathname, location.search), [location.pathname, location.search]);

  useEffect(() => {
    document.title = `${meta.title} · Arra Oracle`;
  }, [meta.title]);

  useEffect(() => {
    if (lastFocusedRouteRef.current === routeKey) {
      return;
    }
    lastFocusedRouteRef.current = routeKey;
    contentRef.current?.focus({ preventScroll: true });
  }, [routeKey]);

  const navItems: NavItem[] = [
    { to: '/', label: 'Menu', description: 'Navigation rows from /api/menu', badge: loading ? '…' : menuCount },
    { to: '/plugins', label: 'Plugins', description: 'Registered plugins and surfaces', badge: loading ? '…' : pluginCount },
    { to: '/status', label: 'Status', description: 'Server health from /api/v1/health' },
    { to: '/canvas?plugin=wave', label: 'Canvas App', description: 'Studio alias for canvas.buildwithoracle.com' },
    { to: '/canvas/plugins', label: 'Canvas Plugins', description: 'Canvas metadata from /api/plugins?kind=canvas' },
    { to: '/search', label: 'Search', description: 'Full-text menu search' },
    { to: '/export', label: 'Export App', description: 'Legacy v2 JSON/Markdown backups' },
    { to: '/vector', label: 'Vector Dashboard', description: 'Collection health and indexing', end: true },
    { to: '/vector/documents', label: 'Document Browser', description: 'Browse indexed vector documents' },
    { to: '/vector/first-run', label: 'First-run setup', description: 'Provider detection and first index' },
    { to: '/vector/index', label: 'Index Manager', description: 'Backfill vectors and watch jobs' },
    { to: '/vector/search', label: 'Vector Search', description: 'Semantic preview by collection' },
    { to: '/vector/settings', label: 'Vector settings', description: 'Collection config and index controls' },
    { to: '/vector/export', label: 'Export', description: 'Download vector collections' },
    { to: '/learn', label: 'Learn', description: 'Create and edit learnings' },
    { to: '/metrics', label: 'Metrics', description: 'Runtime counters from /api/v1/metrics' },
    { to: '/mcp', label: 'MCP', description: 'Tool schemas and groups' },
    { to: '/storage', label: 'Storage', description: 'Backend config from /api/settings/system' },
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
      className="focus-ring rounded-lg border border-err-border px-3 py-2 font-semibold text-err-text hover:bg-err-bg"
      type="button"
      onClick={onRefresh}
    >
      Retry
    </button>
  );

  return (
    <main className="oracle-shell min-h-screen overflow-x-hidden text-text transition-colors">
      <a
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-accent-solid focus:px-4 focus:py-3 focus:font-semibold focus:text-on-accent"
        href="#main-content"
      >
        Skip to main content
      </a>
      <div className="mx-auto grid w-full max-w-7xl gap-4 px-3 py-3 sm:gap-6 sm:px-6 sm:py-6 lg:grid-cols-[18rem_1fr] lg:px-8">
        <NavSidebar items={navItems} />
        <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
          <header className="grid gap-5 rounded-3xl border border-border bg-surface p-4 shadow-2xl shadow-black/5 backdrop-blur sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] lg:items-end dark:shadow-black/20">
            <PageChrome meta={meta} />
            <div className="grid w-full min-w-0 gap-3">
              <CommandPalette onRefresh={onRefresh} />
              <GlobalSearch />
              <div className="flex flex-wrap items-center justify-start gap-3 sm:justify-end">
                <TauriBadge connected={!error} />
                <ThemeToggle />
                <button
                  className="focus-ring rounded-xl bg-accent-solid px-5 py-3 font-semibold text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
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
