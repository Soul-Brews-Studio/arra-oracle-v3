import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { McpPage } from './pages/McpPage';
import { MetricsPage } from './pages/MetricsPage';
import { McpToolDetailPage } from './pages/McpToolDetailPage';
import { LearnPage } from './pages/LearnPage';
import { MenuPage } from './pages/MenuPage';
import { PluginsPage } from './pages/PluginsPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { VectorPage } from './pages/VectorPage';
import { VectorSearchResultsPage } from './pages/VectorSearchResultsPage';
import type { LoadState, MenuItem, PluginEntry } from './types';
import type { MetricsSnapshot } from '../../src/server/types';

export const frontendRoutes = ['/', '/plugins', '/metrics', '/search', '/learn'] as const;
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
  return (
    <Routes>
      <Route index element={menuPage} />
      <Route path="/plugins" element={pluginPage} />
      <Route path="/metrics" element={<MetricsPage metrics={metrics} loading={isRouteLoading(states.metrics)} />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/learn" element={<LearnPage />} />
      <Route path="/menu" element={menuPage} />
      <Route path="/vector" element={<VectorPage />} />
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
