import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { apiClient, type ApiClient } from './api/client';
import { AppShell } from './components/AppShell';
import { countPluginSurfaces } from './plugin-surfaces';
import { McpPage } from './pages/McpPage';
import { McpToolDetailPage } from './pages/McpToolDetailPage';
import { MenuPage } from './pages/MenuPage';
import { PluginsPage } from './pages/PluginsPage';
import { SettingsPage } from './pages/SettingsPage';
import { VectorPage } from './pages/VectorPage';
import { VectorSearchResultsPage } from './pages/VectorSearchResultsPage';
import type { LoadState, MenuItem, PluginEntry } from './types';
import type { MetricsSnapshot } from '../../src/server/types';

type DashboardClient = Pick<ApiClient, 'menu' | 'plugins' | 'metrics'>;
type DashboardKey = 'menu' | 'plugins' | 'metrics';
export type DashboardErrors = Partial<Record<DashboardKey, string>>;

type LoadStates = Record<DashboardKey, LoadState>;

export interface DashboardLoadResult {
  menu: MenuItem[] | null;
  plugins: PluginEntry[] | null;
  metrics: MetricsSnapshot | null;
  errors: DashboardErrors;
}

const loadingStates: LoadStates = { menu: 'loading', plugins: 'loading', metrics: 'loading' };
const idleStates: LoadStates = { menu: 'idle', plugins: 'idle', metrics: 'idle' };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stateFor(key: DashboardKey, errors: DashboardErrors): LoadState {
  return errors[key] ? 'error' : 'ready';
}

function isLoading(state: LoadState): boolean {
  return state === 'loading' || state === 'idle';
}

export async function loadDashboardData(client: DashboardClient = apiClient): Promise<DashboardLoadResult> {
  const [menu, plugins, metrics] = await Promise.allSettled([
    client.menu(),
    client.plugins(),
    client.metrics(),
  ]);
  const errors: DashboardErrors = {};
  if (menu.status === 'rejected') errors.menu = `Menu: ${errorText(menu.reason)}`;
  if (plugins.status === 'rejected') errors.plugins = `Plugins: ${errorText(plugins.reason)}`;
  if (metrics.status === 'rejected') errors.metrics = `Metrics: ${errorText(metrics.reason)}`;

  return {
    menu: menu.status === 'fulfilled' ? menu.value.items : null,
    plugins: plugins.status === 'fulfilled' ? plugins.value.plugins : null,
    metrics: metrics.status === 'fulfilled' ? metrics.value : null,
    errors,
  };
}

export default function App() {
  const [states, setStates] = useState<LoadStates>(idleStates);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [errors, setErrors] = useState<DashboardErrors>({});
  const [updatedAt, setUpdatedAt] = useState('never');

  async function load() {
    setStates(loadingStates);
    const result = await loadDashboardData();
    if (result.menu) setMenu(result.menu);
    if (result.plugins) setPlugins(result.plugins);
    if (result.metrics) setMetrics(result.metrics);
    setErrors(result.errors);
    setStates({
      menu: stateFor('menu', result.errors),
      plugins: stateFor('plugins', result.errors),
      metrics: stateFor('metrics', result.errors),
    });
    setUpdatedAt(new Date().toLocaleTimeString());
  }

  async function refreshMetrics() {
    setStates((current) => ({ ...current, metrics: 'loading' }));
    try {
      setMetrics(await apiClient.metrics());
      setErrors(({ metrics: _metrics, ...rest }) => rest);
      setStates((current) => ({ ...current, metrics: 'ready' }));
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setErrors((current) => ({ ...current, metrics: `Metrics: ${errorText(err)}` }));
      setStates((current) => ({ ...current, metrics: 'error' }));
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void refreshMetrics(), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const surfaceCount = useMemo(() => countPluginSurfaces(plugins), [plugins]);
  const loading = isLoading(states.menu) || isLoading(states.plugins);
  const metricsLoading = isLoading(states.metrics);
  const error = Object.values(errors).filter(Boolean).join(' · ');
  const refresh = () => void load();

  return (
    <BrowserRouter>
      <AppShell
        error={error}
        loading={loading}
        menuCount={menu.length}
        pluginCount={plugins.length}
        surfaceCount={surfaceCount}
        metrics={metrics}
        metricsLoading={metricsLoading}
        updatedAt={updatedAt}
        onRefresh={refresh}
      >
        <Routes>
          <Route index element={<Navigate to="/menu" replace />} />
          <Route path="/menu" element={<MenuPage items={menu} loading={isLoading(states.menu)} />} />
          <Route path="/plugins" element={<PluginsPage plugins={plugins} loading={isLoading(states.plugins)} />} />
          <Route path="/vector" element={<VectorPage />} />
          <Route path="/vector/results" element={<VectorSearchResultsPage />} />
          <Route path="/mcp" element={<McpPage />} />
          <Route path="/mcp/tools/:name" element={<McpToolDetailPage />} />
          <Route
            path="/settings"
            element={<SettingsPage menuCount={menu.length} pluginCount={plugins.length} surfaceCount={surfaceCount} updatedAt={updatedAt} onRefresh={refresh} />}
          />
          <Route path="*" element={<Navigate to="/menu" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
