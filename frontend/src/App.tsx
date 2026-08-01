import { useEffect, useMemo, useState } from 'react';
import { apiClient, type ApiClient } from './api/client';
import { AppShell } from './components/AppShell';
import { countPluginSurfaces } from './plugin-surfaces';
import { AppRouter, DashboardRoutes, SimpleRoutes, isRouteLoading } from './router';
import type { LoadState, MenuItem, PluginEntry } from './types';
import type { MetricsSnapshot } from '../../src/server/types';
import type { X402StatsResponse } from '../../src/routes/x402/stats-types';

type DashboardClient = Pick<ApiClient, 'menu' | 'plugins' | 'metrics' | 'x402Stats'>;
type DashboardKey = 'menu' | 'plugins' | 'metrics' | 'x402';
export type DashboardErrors = Partial<Record<DashboardKey, string>>;

type LoadStates = Record<DashboardKey, LoadState>;

export interface DashboardLoadResult {
  menu: MenuItem[] | null;
  plugins: PluginEntry[] | null;
  metrics: MetricsSnapshot | null;
  x402: X402StatsResponse | null;
  errors: DashboardErrors;
}

const loadingStates: LoadStates = { menu: 'loading', plugins: 'loading', metrics: 'loading', x402: 'loading' };
const idleStates: LoadStates = { menu: 'idle', plugins: 'idle', metrics: 'idle', x402: 'idle' };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stateFor(key: DashboardKey, errors: DashboardErrors): LoadState {
  return errors[key] ? 'error' : 'ready';
}

export async function loadDashboardData(client: DashboardClient = apiClient): Promise<DashboardLoadResult> {
  const [menu, plugins, metrics, x402] = await Promise.allSettled([
    client.menu(),
    client.plugins(),
    client.metrics(),
    client.x402Stats({ limit: 50 }),
  ]);
  const errors: DashboardErrors = {};
  if (menu.status === 'rejected') errors.menu = `Menu: ${errorText(menu.reason)}`;
  if (plugins.status === 'rejected') errors.plugins = `Plugins: ${errorText(plugins.reason)}`;
  if (metrics.status === 'rejected') errors.metrics = `Metrics: ${errorText(metrics.reason)}`;
  if (x402.status === 'rejected') errors.x402 = `x402: ${errorText(x402.reason)}`;

  return {
    menu: menu.status === 'fulfilled' ? menu.value.items : null,
    plugins: plugins.status === 'fulfilled' ? plugins.value.plugins : null,
    metrics: metrics.status === 'fulfilled' ? metrics.value : null,
    x402: x402.status === 'fulfilled' ? x402.value : null,
    errors,
  };
}

function DashboardApp() {
  const [states, setStates] = useState<LoadStates>(idleStates);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [x402, setX402] = useState<X402StatsResponse | null>(null);
  const [errors, setErrors] = useState<DashboardErrors>({});
  const [updatedAt, setUpdatedAt] = useState('never');

  async function load() {
    setStates(loadingStates);
    const result = await loadDashboardData();
    if (result.menu) setMenu(result.menu);
    if (result.plugins) setPlugins(result.plugins);
    if (result.metrics) setMetrics(result.metrics);
    if (result.x402) setX402(result.x402);
    setErrors(result.errors);
    setStates({
      menu: stateFor('menu', result.errors),
      plugins: stateFor('plugins', result.errors),
      metrics: stateFor('metrics', result.errors),
      x402: stateFor('x402', result.errors),
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
  const loading = isRouteLoading(states.menu) || isRouteLoading(states.plugins);
  const metricsLoading = isRouteLoading(states.metrics);
  const error = Object.values(errors).filter(Boolean).join(' · ');
  const refresh = () => void load();

  return (
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
      <DashboardRoutes
        menu={menu}
        plugins={plugins}
        states={states}
        metrics={metrics}
        x402={x402}
        surfaceCount={surfaceCount}
        updatedAt={updatedAt}
        onRefresh={refresh}
      />
    </AppShell>
  );
}

function isSimpleRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/simple';
}

export default function App() {
  return (
    <AppRouter>
      {isSimpleRoute() ? <SimpleRoutes /> : <DashboardApp />}
    </AppRouter>
  );
}
