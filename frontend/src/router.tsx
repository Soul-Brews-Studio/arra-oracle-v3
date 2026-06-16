import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { McpPage } from './pages/McpPage';
import { MetricsPage } from './pages/MetricsPage';
import { McpToolDetailPage } from './pages/McpToolDetailPage';
import { ExportPage } from './pages/ExportPage';
import { LearnPage } from './pages/LearnPage';
import { MenuPage } from './pages/MenuPage';
import { PluginsPage } from './pages/PluginsPage';
import { CanvasPluginsPage } from './pages/CanvasPluginsPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatusPage } from './pages/StatusPage';
import { VectorPage } from './pages/VectorPage';
import { VectorSearchPage } from './pages/VectorSearchPage';
import { VectorDocumentsPage } from './pages/VectorDocumentsPage';
import { VectorSearchResultsPage } from './pages/VectorSearchResultsPage';
import { VectorExportPage } from './pages/VectorExportPage';
import { VectorSettingsPage } from './pages/VectorSettingsPage';
import type { LoadState, MenuItem, PluginEntry } from './types';
import type { MetricsSnapshot } from '../../src/server/types';

export const frontendRoutes = [
  '/',
  '/menu',
  '/plugins',
  '/status',
  '/canvas/plugins',
  '/metrics',
  '/search',
  '/export',
  '/learn',
  '/vector',
  '/vector/search',
  '/vector/documents',
  '/vector/results',
  '/vector/export',
  '/vector/settings',
] as const;
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
  const menuPage = <MenuPage />;
  const pluginPage = <PluginsPage plugins={plugins} loading={isRouteLoading(states.plugins)} />;
  return (
    <Routes>
      <Route index element={menuPage} />
      <Route path="/plugins" element={pluginPage} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/canvas/plugins" element={<CanvasPluginsPage />} />
      <Route path="/metrics" element={<MetricsPage metrics={metrics} loading={isRouteLoading(states.metrics)} />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/export" element={<ExportPage />} />
      <Route path="/learn" element={<LearnPage />} />
      <Route path="/menu" element={menuPage} />
      <Route path="/vector" element={<VectorPage />} />
      <Route path="/vector/search" element={<VectorSearchPage />} />
      <Route path="/vector/documents" element={<VectorDocumentsPage />} />
      <Route path="/vector/results" element={<VectorSearchResultsPage />} />
      <Route path="/vector/export" element={<VectorExportPage />} />
      <Route path="/vector/settings" element={<VectorSettingsPage />} />
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
