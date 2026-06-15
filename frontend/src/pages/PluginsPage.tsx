import { useEffect, useMemo, useState } from 'react';
import { apiClient, type ApiClient } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { PluginList, isPluginEnabled, togglePluginEnabled, type PluginEnabledState } from '../components/PluginList';
import type { PluginEntry } from '../types';

type PageState = 'loading' | 'ready' | 'error';
type PluginsClient = Pick<ApiClient, 'plugins'>;

export interface PluginsPageProps {
  plugins?: PluginEntry[];
  loading?: boolean;
  client?: PluginsClient;
}

export function enabledStateForPlugins(plugins: PluginEntry[]): PluginEnabledState {
  return Object.fromEntries(plugins.map((plugin) => [
    plugin.name,
    typeof plugin.enabled === 'boolean' ? plugin.enabled : plugin.status !== 'disabled',
  ]));
}

export function pluginAdminSummary(plugins: PluginEntry[], enabledState: PluginEnabledState): string {
  const enabled = plugins.filter((plugin) => isPluginEnabled(plugin, enabledState)).length;
  const disabled = plugins.length - enabled;
  return `${enabled} enabled · ${disabled} disabled · ${plugins.length} registered`;
}

export function PluginsPage({ plugins: initialPlugins = [], loading = true, client = apiClient }: PluginsPageProps) {
  const [plugins, setPlugins] = useState(initialPlugins);
  const [state, setState] = useState<PageState>(loading ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const [enabledState, setEnabledState] = useState<PluginEnabledState>(() => enabledStateForPlugins(initialPlugins));

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError('');
    client.plugins()
      .then((response) => {
        if (cancelled) return;
        setPlugins(response.plugins);
        setEnabledState(enabledStateForPlugins(response.plugins));
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState(initialPlugins.length ? 'ready' : 'error');
      });
    return () => { cancelled = true; };
  }, [client]);

  const summary = useMemo(() => pluginAdminSummary(plugins, enabledState), [plugins, enabledState]);
  const toggle = (name: string) => setEnabledState((current) => togglePluginEnabled(current, name));
  const isLoading = state === 'loading';

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="plugins-page-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Plugin admin</p>
          <h2 id="plugins-page-title" className="mt-2 text-2xl font-semibold text-white">Registered plugins</h2>
          <p className="mt-2 text-sm text-slate-400">Loaded from GET /api/v1/plugins with local enable/disable controls.</p>
        </div>
        <p className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300">{summary}</p>
      </div>
      {isLoading ? <LoadingPanel title="Loading plugins…" detail="Fetching /api/v1/plugins and plugin server manifests." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load plugins." message={error} /> : null}
      {!isLoading && state !== 'error' ? <PluginList plugins={plugins} enabledState={enabledState} onToggle={toggle} /> : null}
    </section>
  );
}
