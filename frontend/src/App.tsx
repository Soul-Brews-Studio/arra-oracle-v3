import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { fetchMenu, fetchPlugins } from './api';
import { AppShell } from './components/AppShell';
import { countPluginSurfaces } from './plugin-surfaces';
import { McpPage } from './pages/McpPage';
import { MenuPage } from './pages/MenuPage';
import { PluginsPage } from './pages/PluginsPage';
import { SettingsPage } from './pages/SettingsPage';
import { VectorPage } from './pages/VectorPage';
import type { LoadState, MenuItem, PluginEntry } from './types';

export default function App() {
  const [state, setState] = useState<LoadState>('idle');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('never');

  async function load() {
    setState('loading');
    setError('');
    try {
      const [menuResponse, pluginsResponse] = await Promise.all([fetchMenu(), fetchPlugins()]);
      setMenu(menuResponse.items);
      setPlugins(pluginsResponse.plugins);
      setUpdatedAt(new Date().toLocaleTimeString());
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const surfaceCount = useMemo(() => countPluginSurfaces(plugins), [plugins]);
  const loading = state === 'loading' || state === 'idle';
  const refresh = () => void load();

  return (
    <BrowserRouter>
      <AppShell
        error={error}
        loading={loading}
        menuCount={menu.length}
        pluginCount={plugins.length}
        surfaceCount={surfaceCount}
        updatedAt={updatedAt}
        onRefresh={refresh}
      >
        <Routes>
          <Route index element={<Navigate to="/menu" replace />} />
          <Route path="/menu" element={<MenuPage items={menu} loading={loading} />} />
          <Route path="/plugins" element={<PluginsPage plugins={plugins} loading={loading} />} />
          <Route path="/vector" element={<VectorPage />} />
          <Route path="/mcp" element={<McpPage />} />
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
