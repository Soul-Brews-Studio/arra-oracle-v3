import { useMemo } from 'react';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { isPluginEnabled, pluginStatusLabel, type PluginEnabledState } from '../components/PluginList';
import { PLUGINS_ENDPOINT, usePlugins, type PluginFetch } from '../hooks/usePlugins';
import { surfacesFor } from '../plugin-surfaces';
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

function Pill({ children, tone = 'idle' }: { children: string; tone?: Tone }) {
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass(tone)}`}>{children}</span>;
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

function Detail({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-slate-100">{value}</dd>
      {detail ? <dd className="mt-1 text-xs text-slate-500">{detail}</dd> : null}
    </div>
  );
}

function PluginCard({ plugin, enabled }: { plugin: PluginEntry; enabled: boolean }) {
  const health = healthForPlugin(plugin, enabled);
  const surfaces = surfacesFor(plugin);
  const status = enabled ? 'active' : 'inactive';

  return (
    <article className="rounded-lg border border-white/10 bg-slate-950/70 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{plugin.name}</h2>
          <p className="mt-1 text-sm text-slate-400">{plugin.description ?? 'Installed plugin manifest.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={enabled ? 'ok' : 'idle'}>{status}</Pill>
          <Pill tone={health.tone}>{health.label}</Pill>
        </div>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <Detail label="Status" value={status} detail={pluginStatusLabel(plugin, enabled)} />
        <Detail label="Version" value={plugin.version ?? 'unknown'} />
        <Detail label="Health" value={health.label} detail={health.detail} />
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        {surfaces.length ? surfaces.map((surface) => <Pill key={surface}>{surface}</Pill>) : <Pill>metadata</Pill>}
      </div>
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
  const { plugins, loading: fetching, error } = usePlugins({ initialPlugins, initialLoading, endpoint, fetcher });
  const enabledState = useMemo(() => enabledStateForPlugins(plugins), [plugins]);
  const summary = useMemo(() => pluginAdminSummary(plugins, enabledState), [plugins, enabledState]);
  const metrics = useMemo(() => {
    const active = plugins.filter((plugin) => isPluginEnabled(plugin, enabledState)).length;
    const unhealthy = plugins.filter((plugin) => healthForPlugin(plugin, isPluginEnabled(plugin, enabledState)).tone === 'bad').length;
    return { active, inactive: plugins.length - active, unhealthy };
  }, [plugins, enabledState]);
  const showInventory = plugins.length > 0 || !fetching;

  return (
    <section className="grid gap-5" aria-labelledby="plugins-page-title">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Plugin list</p>
        <h1 id="plugins-page-title" className="mt-2 text-3xl font-semibold text-white">Installed plugin status</h1>
        <p className="mt-2 text-sm text-slate-400">Registered plugins and live installed inventory from GET {endpoint}.</p>
      </header>

      {fetching ? <LoadingPanel title="Loading plugins…" detail={`Fetching ${endpoint} and plugin health metadata.`} /> : null}
      {error ? <ErrorMessage title="Could not load plugins." message={error} /> : null}

      {showInventory ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Installed" value={plugins.length} detail={summary} />
          <MetricCard label="Active" value={metrics.active} detail="ready to serve surfaces" tone="ok" />
          <MetricCard label="Inactive" value={metrics.inactive} detail="disabled or unavailable" />
          <MetricCard label="Health" value={metrics.unhealthy ? `${metrics.unhealthy} alert` : 'ok'} detail="manifest and server signal" tone={metrics.unhealthy ? 'bad' : 'ok'} />
        </div>
      ) : null}

      {plugins.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {plugins.map((plugin) => (
            <PluginCard key={plugin.name} plugin={plugin} enabled={isPluginEnabled(plugin, enabledState)} />
          ))}
        </div>
      ) : showInventory ? (
        <p className="rounded-lg border border-white/10 bg-slate-950/70 p-5 text-sm text-slate-400">
          No installed plugins returned by {endpoint}.
        </p>
      ) : null}
    </section>
  );
}
