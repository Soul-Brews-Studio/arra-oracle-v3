import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingPanel } from './components/AsyncState';
import { StatCard } from './components/StatCard';
import { McpPage } from './pages/McpPage';
import { McpToolDetailPage } from './pages/McpToolDetailPage';
import { MenuPage } from './pages/MenuPage';
import { PluginsPage } from './pages/PluginsPage';
import { SettingsPage } from './pages/SettingsPage';
import { VectorPage } from './pages/VectorPage';
import { VectorSearchResultsPage } from './pages/VectorSearchResultsPage';
import type { LoadState, MenuItem, PluginEntry } from './types';
import type { MetricsSnapshot } from '../../src/server/types';

export const frontendRoutes = ['/', '/plugins', '/metrics', '/search'] as const;
export type FrontendRoute = typeof frontendRoutes[number];

export type DashboardRouteStates = Record<'menu' | 'plugins' | 'metrics', LoadState>;

export interface DashboardRoutesProps {
  menu: MenuItem[];
  plugins: PluginEntry[];
  states: DashboardRouteStates;
  metrics: MetricsSnapshot | null;
  surfaceCount: number;
  updatedAt: string;
  onRefresh: () => void;
}

export function isRouteLoading(state: LoadState): boolean {
  return state === 'loading' || state === 'idle';
}

export function AppRouter({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <BrowserRouter>{children}</BrowserRouter>
    </ErrorBoundary>
  );
}

function MetricsPage({ metrics, loading }: { metrics: MetricsSnapshot | null; loading: boolean }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="metrics-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Metrics</p>
      <h2 id="metrics-page-title" className="mt-2 mb-4 text-2xl font-semibold text-white">Backend metrics</h2>
      {loading ? <LoadingPanel title="Loading metrics…" detail="Fetching /api/metrics from the Elysia backend." /> : null}
      {!loading && !metrics ? <p className="text-sm text-slate-400">No metrics snapshot is available yet.</p> : null}
      {metrics ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Requests" value={metrics.requestCount} detail="tracked by Elysia lifecycle" />
          <StatCard label="Avg response" value={`${metrics.avgResponseMs} ms`} detail="mean response time" />
          <StatCard label="Active" value={metrics.activeConnections} detail="active HTTP requests" />
          <StatCard label="Uptime" value={`${Math.round(metrics.uptime)}s`} detail={`since ${metrics.lastRestart}`} />
        </div>
      ) : null}
    </section>
  );
}

export function DashboardRoutes({
  menu,
  plugins,
  states,
  metrics,
  surfaceCount,
  updatedAt,
  onRefresh,
}: DashboardRoutesProps) {
  const menuPage = <MenuPage items={menu} loading={isRouteLoading(states.menu)} />;
  const pluginPage = <PluginsPage plugins={plugins} loading={isRouteLoading(states.plugins)} />;
  const metricsPage = <MetricsPage metrics={metrics} loading={isRouteLoading(states.metrics)} />;

  return (
    <Routes>
      <Route index element={menuPage} />
      <Route path="/plugins" element={pluginPage} />
      <Route path="/metrics" element={metricsPage} />
      <Route path="/search" element={<VectorPage />} />
      <Route path="/search/results" element={<VectorSearchResultsPage />} />
      <Route path="/menu" element={menuPage} />
      <Route path="/vector" element={<Navigate to="/search" replace />} />
      <Route path="/vector/results" element={<VectorSearchResultsPage />} />
      <Route path="/mcp" element={<McpPage />} />
      <Route path="/mcp/tools/:name" element={<McpToolDetailPage />} />
      <Route
        path="/settings"
        element={<SettingsPage menuCount={menu.length} pluginCount={plugins.length} surfaceCount={surfaceCount} updatedAt={updatedAt} onRefresh={onRefresh} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
