import { useEffect, useMemo, useState } from 'react';
import { apiClient, type ApiClient } from '../api/client';
import { setPluginEnabled } from '../api/plugin-admin';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { pluginStatusLabel, isPluginEnabled, type PluginEnabledState } from '../components/PluginList';
import { surfacesFor } from '../plugin-surfaces';
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

function pluginStatusClass(status: string): string {
  if (status === 'ok') return 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200';
  if (status === 'disabled') return 'border-slate-300/30 bg-slate-900/70 text-slate-200';
  return 'border-amber-300/30 bg-amber-300/10 text-amber-100';
}

function PluginsCards({
  plugins,
  enabledState,
  onToggle,
  pending,
}: {
  plugins: PluginEntry[];
  enabledState: PluginEnabledState;
  onToggle: (name: string, enabled: boolean) => void;
  pending: string | null;
}) {
  if (!plugins.length) return <p className="text-sm text-slate-400">No plugins are registered.</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {plugins.map((plugin) => {
        const enabled = isPluginEnabled(plugin, enabledState);
        const status = pluginStatusLabel(plugin, enabled);
        const surfaces = surfacesFor(plugin);
        return (
          <article key={plugin.name} className="rounded-3xl border border-white/10 bg-slate-950/70 p-4 sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Plugin</p>
                <h3 className="mt-1 text-lg font-semibold text-white">{plugin.name}</h3>
              </div>
              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${pluginStatusClass(status)}`}>
                {status}
              </span>
            </div>

            <p className="text-sm text-slate-300">{plugin.description ?? 'No description supplied.'}</p>

            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Version</dt>
                <dd className="font-mono text-slate-100">{plugin.version ?? 'unknown'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Artifact</dt>
                <dd className="font-mono text-slate-100">{plugin.file || 'server-only'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Surfaces</dt>
                <dd className="text-slate-200">{surfaces.length ? surfaces.join(', ') : 'metadata'}</dd>
              </div>
            </dl>

            <div className="mt-4 flex justify-end">
              <button
                aria-label={`${enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                aria-pressed={enabled}
                className="focus-ring rounded-lg border border-teal-300/30 px-3 py-2 text-sm font-semibold text-teal-100 transition hover:bg-teal-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={pending === plugin.name}
                type="button"
                onClick={() => onToggle(plugin.name, !enabled)}
              >
                {pending === plugin.name ? 'Saving…' : enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function PluginsPage({ plugins: initialPlugins = [], loading = true, client = apiClient }: PluginsPageProps) {
  const [plugins, setPlugins] = useState(initialPlugins);
  const [state, setState] = useState<PageState>(loading ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [pendingPlugin, setPendingPlugin] = useState<string | null>(null);
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
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState(initialPlugins.length ? 'ready' : 'error');
      });
    return () => { cancelled = true; };
  }, [client]);

  const summary = useMemo(() => pluginAdminSummary(plugins, enabledState), [plugins, enabledState]);
  const isLoading = state === 'loading';

  async function togglePlugin(name: string, enabled: boolean) {
    setPendingPlugin(name);
    setActionMessage('');
    try {
      const response = await setPluginEnabled(name, enabled);
      setEnabledState((current) => ({ ...current, [name]: response.enabled }));
      setActionMessage(response.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingPlugin(null);
    }
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="plugins-page-title">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Plugin admin</p>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Plugin list</p>
            <h2 id="plugins-page-title" className="mt-2 text-2xl font-semibold text-white">Registered plugins</h2>
            <p className="mt-2 text-sm text-slate-400">Loaded from GET /api/v1/plugins with manifest-backed enable/disable controls.</p>
          </div>
          <p className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300">{summary}</p>
        </div>
        {isLoading ? <LoadingPanel title="Loading plugins…" detail="Fetching /api/v1/plugins and plugin server manifests." /> : null}
        {state === 'error' ? <ErrorMessage title="Could not load plugins." message={error} /> : null}
        {state !== 'error' && error ? <ErrorMessage title="Plugin action failed." message={error} /> : null}
        {actionMessage ? <p className="mt-3 text-sm text-amber-200">{actionMessage}</p> : null}
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-label="Plugin registry cards">
        {isLoading || state === 'error'
          ? null
          : <PluginsCards
              plugins={plugins}
              enabledState={enabledState}
              onToggle={(name, enabled) => void togglePlugin(name, enabled)}
              pending={pendingPlugin}
            />}
      </section>
    </div>
  );
}
