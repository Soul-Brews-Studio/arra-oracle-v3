import { useMemo, useState } from 'react';
import { setPluginEnabled } from '../api/plugin-admin';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { isPluginEnabled, PluginList, type PluginEnabledState } from '../components/PluginList';
import { PLUGINS_ENDPOINT, usePlugins, type PluginFetch } from '../hooks/usePlugins';
import { countPluginSurfaces } from '../plugin-surfaces';
import { UnifiedPluginSurfaceOverview } from './UnifiedPluginSurfaceOverview';
import type { PluginEntry } from '../types';

const EMPTY_PLUGINS: PluginEntry[] = [];

type Tone = 'ok' | 'warn' | 'bad' | 'idle';

export interface PluginsPageProps {
  plugins?: PluginEntry[];
  loading?: boolean;
  endpoint?: string;
  fetcher?: PluginFetch;
}

export function enabledStateForPlugins(plugins: PluginEntry[]): PluginEnabledState {
  return Object.fromEntries(plugins.map((plugin) => [
    plugin.name,
    plugin.enabled ?? plugin.status !== 'disabled',
  ]));
}

export function pluginAdminSummary(plugins: PluginEntry[], enabledState: PluginEnabledState): string {
  const enabled = plugins.filter((plugin) => isPluginEnabled(plugin, enabledState)).length;
  const disabled = plugins.length - enabled;
  return `${enabled} enabled · ${disabled} disabled · ${plugins.length} registered`;
}

function toneClass(tone: Tone): string {
  const tones: Record<Tone, string> = {
    ok: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100',
    warn: 'border-amber-300/30 bg-amber-400/10 text-amber-100',
    bad: 'border-red-300/30 bg-red-400/10 text-red-100',
    idle: 'border-slate-500/40 bg-slate-800 text-slate-200',
  };
  return tones[tone];
}

function healthForPlugin(plugin: PluginEntry, enabled: boolean): { label: string; detail: string; tone: Tone } {
  if (!enabled) return { label: 'inactive', detail: 'disabled in plugin state', tone: 'idle' };
  if (plugin.error) return { label: 'unhealthy', detail: plugin.error, tone: 'bad' };
  if (plugin.status === 'degraded') return { label: 'degraded', detail: 'reported by plugin manifest', tone: 'warn' };
  if (plugin.status && plugin.status !== 'ok') {
    return { label: plugin.status, detail: plugin.server?.healthPath ?? 'reported by plugin manifest', tone: 'warn' };
  }
  return { label: 'healthy', detail: plugin.server?.healthPath ?? 'manifest ok', tone: 'ok' };
}

function MetricCard({ label, value, detail, tone = 'idle' }: { label: string; value: string | number; detail: string; tone?: Tone }) {
  return (
    <article className={`rounded-lg border p-4 ${toneClass(tone)}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm opacity-75">{detail}</p>
    </article>
  );
}

export function PluginsPage({
  plugins: initialPlugins = EMPTY_PLUGINS,
  loading = false,
  endpoint = PLUGINS_ENDPOINT,
  fetcher,
}: PluginsPageProps) {
  const initialLoading = loading || initialPlugins.length === 0;
  const { plugins, loading: fetching, error, reload } = usePlugins({ initialPlugins, initialLoading, endpoint, fetcher });
  const [overrides, setOverrides] = useState<PluginEnabledState>({});
  const [adminError, setAdminError] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const enabledState = useMemo(() => ({ ...enabledStateForPlugins(plugins), ...overrides }), [plugins, overrides]);
  const summary = useMemo(() => pluginAdminSummary(plugins, enabledState), [plugins, enabledState]);
  const metrics = useMemo(() => {
    const active = plugins.filter((plugin) => isPluginEnabled(plugin, enabledState)).length;
    const unhealthy = plugins.filter((plugin) => healthForPlugin(plugin, isPluginEnabled(plugin, enabledState)).tone === 'bad').length;
    const surfaces = countPluginSurfaces(plugins);
    return { active, inactive: plugins.length - active, unhealthy, surfaces };
  }, [plugins, enabledState]);
  const showInventory = plugins.length > 0 || !fetching;

  async function togglePlugin(name: string) {
    const plugin = plugins.find((item) => item.name === name);
    if (!plugin) return;
    const next = !isPluginEnabled(plugin, enabledState);
    setAdminError('');
    setAdminMessage(`Saving ${name}…`);
    setOverrides((current) => ({ ...current, [name]: next }));
    try {
      const result = await setPluginEnabled(name, next);
      setAdminMessage(result.message);
      reload();
    } catch (cause) {
      setOverrides((current) => {
        const copy = { ...current };
        delete copy[name];
        return copy;
      });
      setAdminError(cause instanceof Error ? cause.message : String(cause));
      setAdminMessage('');
    }
  }

  return (
    <section className="grid gap-5" aria-labelledby="plugins-page-title">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Plugin management</p>
        <h1 id="plugins-page-title" className="mt-2 text-3xl font-semibold text-white">Unified plugin surfaces</h1>
        <p className="mt-2 text-sm text-slate-400">Registered plugins, backend surfaces, and enable/disable controls from GET {endpoint}.</p>
      </header>

      {fetching ? <LoadingPanel title="Loading plugins…" detail={`Fetching ${endpoint} and plugin health metadata.`} /> : null}
      {error ? <ErrorMessage title="Could not load plugins." message={error} /> : null}

      {showInventory ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Installed" value={plugins.length} detail={summary} />
          <MetricCard label="Active" value={metrics.active} detail="ready to serve surfaces" tone="ok" />
          <MetricCard label="Inactive" value={metrics.inactive} detail="disabled or unavailable" />
          <MetricCard label="Surfaces" value={metrics.surfaces} detail="menu, server, MCP, API, proxy, CLI, export" />
          <MetricCard label="Health" value={metrics.unhealthy ? `${metrics.unhealthy} alert` : 'ok'} detail="manifest and server signal" tone={metrics.unhealthy ? 'bad' : 'ok'} />
        </div>
      ) : null}

      {adminMessage ? <p className="rounded-lg border border-teal-300/20 bg-teal-300/10 p-3 text-sm text-teal-100">{adminMessage}</p> : null}
      {adminError ? <ErrorMessage title="Could not update plugin state." message={adminError} /> : null}

      {showInventory ? <UnifiedPluginSurfaceOverview plugins={plugins} /> : null}

      {plugins.length ? (
        <PluginList plugins={plugins} enabledState={enabledState} onToggle={(name) => void togglePlugin(name)} />
      ) : showInventory ? (
        <p className="rounded-lg border border-white/10 bg-slate-950/70 p-5 text-sm text-slate-400">
          No installed plugins returned by {endpoint}.
        </p>
      ) : null}
    </section>
  );
}
