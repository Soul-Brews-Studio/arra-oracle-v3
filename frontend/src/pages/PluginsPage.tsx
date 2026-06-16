import { useMemo, useState } from 'react';
import { setPluginEnabled } from '../api/plugin-admin';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { isPluginEnabled, PluginList, type PluginEnabledState } from '../components/PluginList';
import { PLUGINS_ENDPOINT, usePlugins, type PluginFetch } from '../hooks/usePlugins';
import { countPluginSurfaces } from '../plugin-surfaces';
import {
  enabledStateForPlugins,
  filteredPluginsFor,
  healthForPlugin,
  pluginAdminSummary,
  pluginSurfaceFilterOptions,
  type PluginSurfaceFilter,
  type PluginVisibilityFilter,
  type Tone,
} from './pluginInventory';
import { UnifiedPluginSurfaceOverview } from './UnifiedPluginSurfaceOverview';
import type { PluginEntry } from '../types';

const EMPTY_PLUGINS: PluginEntry[] = [];

export {
  enabledStateForPlugins,
  filteredPluginsFor,
  pluginAdminSummary,
  pluginSurfaceFilterOptions,
} from './pluginInventory';
export type { PluginSurfaceFilter, PluginVisibilityFilter } from './pluginInventory';

export interface PluginsPageProps {
  plugins?: PluginEntry[];
  loading?: boolean;
  endpoint?: string;
  fetcher?: PluginFetch;
  initialQuery?: string;
  initialVisibility?: PluginVisibilityFilter;
  initialSurface?: PluginSurfaceFilter;
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
  initialQuery = '',
  initialVisibility = 'all',
  initialSurface = 'all',
}: PluginsPageProps) {
  const initialLoading = loading || initialPlugins.length === 0;
  const { plugins, loading: fetching, error, reload } = usePlugins({ initialPlugins, initialLoading, endpoint, fetcher });
  const [overrides, setOverrides] = useState<PluginEnabledState>({});
  const [query, setQuery] = useState(initialQuery);
  const [visibility, setVisibility] = useState<PluginVisibilityFilter>(initialVisibility);
  const [surface, setSurface] = useState<PluginSurfaceFilter>(initialSurface);
  const [adminError, setAdminError] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const enabledState = useMemo(() => ({ ...enabledStateForPlugins(plugins), ...overrides }), [plugins, overrides]);
  const summary = useMemo(() => pluginAdminSummary(plugins, enabledState), [plugins, enabledState]);
  const surfaceOptions = useMemo(() => pluginSurfaceFilterOptions(plugins), [plugins]);
  const visiblePlugins = useMemo(() => filteredPluginsFor(plugins, enabledState, query, visibility, surface), [plugins, enabledState, query, visibility, surface]);
  const hasFilters = query.trim().length > 0 || visibility !== 'all' || surface !== 'all';
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
        <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4" aria-labelledby="plugin-filters-title">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Inventory filters</p>
              <h2 id="plugin-filters-title" className="mt-1 text-lg font-semibold text-white">Find plugin surfaces</h2>
              <p className="mt-1 text-sm text-slate-400">Showing {visiblePlugins.length} of {plugins.length} plugins · {summary}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_10rem_10rem_auto]">
              <label className="grid gap-1 text-sm font-medium text-slate-300">
                Search plugins
                <input
                  className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-100"
                  placeholder="name, route, MCP tool, surface"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-300">
                Visibility
                <select
                  className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-100"
                  value={visibility}
                  onChange={(event) => setVisibility(event.currentTarget.value as PluginVisibilityFilter)}
                >
                  <option value="all">All plugins</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                  <option value="unhealthy">Needs attention</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium text-slate-300">
                Surface
                <select
                  className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-100"
                  value={surface}
                  onChange={(event) => setSurface(event.currentTarget.value as PluginSurfaceFilter)}
                >
                  <option value="all">All surfaces</option>
                  {surfaceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <button
                className="focus-ring self-end rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-teal-300/40 disabled:opacity-40"
                disabled={!hasFilters}
                type="button"
                onClick={() => { setQuery(''); setVisibility('all'); setSurface('all'); }}
              >
                Clear filters
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {visiblePlugins.length ? (
        <PluginList plugins={visiblePlugins} enabledState={enabledState} onToggle={(name) => void togglePlugin(name)} />
      ) : plugins.length && showInventory ? (
        <p className="rounded-lg border border-white/10 bg-slate-950/70 p-5 text-sm text-slate-400">
          No plugins match the current filters. Clear filters or reload plugin manifests.
        </p>
      ) : showInventory ? (
        <p className="rounded-lg border border-white/10 bg-slate-950/70 p-5 text-sm text-slate-400">
          No installed plugins returned by {endpoint}.
        </p>
      ) : null}
    </section>
  );
}
