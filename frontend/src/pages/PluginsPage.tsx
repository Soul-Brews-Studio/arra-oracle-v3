import { useMemo, useState } from 'react';
import { setPluginEnabled } from '../api/plugin-admin';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { isPluginEnabled, PluginList, type PluginEnabledState } from '../components/PluginList';
import { PLUGINS_ENDPOINT, usePlugins, type PluginFetch } from '../hooks/usePlugins';
import { countPluginSurfaces } from '../plugin-surfaces';
import { pluginInventoryPath } from '../routePaths';
import {
  enabledStateForPlugins,
  filteredPluginsFor,
  healthForPlugin,
  pluginAdminSummary,
  pluginFiltersFromSearch,
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
  pluginFiltersFromSearch,
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
  initialSearch?: string;
}

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function toneClass(tone: Tone): string {
  const tones: Record<Tone, string> = {
    ok: 'border-ok-border bg-ok-bg text-ok-text',
    warn: 'border-warn-border bg-warn-bg text-warn-text',
    bad: 'border-err-border bg-err-bg text-err-text',
    idle: 'border-slate-500/40 bg-slate-800 text-text',
  };
  return tones[tone];
}

function MetricCard({ label, value, detail, tone = 'idle' }: { label: string; value: string | number; detail: string; tone?: Tone }) {
  return (
    <article className={`min-w-0 rounded-lg border p-4 ${toneClass(tone)}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{label}</p>
      <p className="mt-2 flex min-w-0 items-center gap-2 break-words text-2xl font-semibold">{tone !== 'idle' ? <span aria-hidden="true">●</span> : null}{value}</p>
      <p className="mt-1 break-words text-sm opacity-75">{detail}</p>
    </article>
  );
}

export function PluginsPage({
  plugins: initialPlugins = EMPTY_PLUGINS,
  loading = false,
  endpoint = PLUGINS_ENDPOINT,
  fetcher,
  initialQuery,
  initialVisibility,
  initialSurface,
  initialSearch,
}: PluginsPageProps) {
  const filterDefaults = pluginFiltersFromSearch(initialSearch ?? browserSearch());
  const initialLoading = loading || initialPlugins.length === 0;
  const { plugins, loading: fetching, error, reload } = usePlugins({ initialPlugins, initialLoading, endpoint, fetcher });
  const [overrides, setOverrides] = useState<PluginEnabledState>({});
  const [query, setQuery] = useState(initialQuery ?? filterDefaults.query);
  const [visibility, setVisibility] = useState<PluginVisibilityFilter>(initialVisibility ?? filterDefaults.visibility);
  const [surface, setSurface] = useState<PluginSurfaceFilter>(initialSurface ?? filterDefaults.surface);
  const [adminError, setAdminError] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const enabledState = useMemo(() => ({ ...enabledStateForPlugins(plugins), ...overrides }), [plugins, overrides]);
  const summary = useMemo(() => pluginAdminSummary(plugins, enabledState), [plugins, enabledState]);
  const surfaceOptions = useMemo(() => pluginSurfaceFilterOptions(plugins), [plugins]);
  const visiblePlugins = useMemo(() => filteredPluginsFor(plugins, enabledState, query, visibility, surface), [plugins, enabledState, query, visibility, surface]);
  const selectedSurfaceMissing = surface !== 'all' && !surfaceOptions.includes(surface);
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
    <section className="grid min-w-0 gap-5" aria-labelledby="plugins-page-title">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Plugin management</p>
        <h1 id="plugins-page-title" className="mt-2 text-3xl font-semibold text-text">Unified plugin surfaces</h1>
        <p className="mt-2 text-sm text-text-muted">Registered plugins, backend surfaces, and enable/disable controls from GET {endpoint}.</p>
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

      {adminMessage ? <p className="rounded-lg border border-accent-border p-3 text-sm text-accent">{adminMessage}</p> : null}
      {adminError ? <ErrorMessage title="Could not update plugin state." message={adminError} /> : null}

      {showInventory ? <UnifiedPluginSurfaceOverview plugins={plugins} /> : null}

      {plugins.length ? (
        <section className="min-w-0 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-4" aria-labelledby="plugin-filters-title">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Inventory filters</p>
              <h2 id="plugin-filters-title" className="mt-1 text-lg font-semibold text-text">Find plugin surfaces</h2>
              <p className="mt-1 text-sm text-text-muted">Showing {visiblePlugins.length} of {plugins.length} plugins · {summary}</p>
            </div>
            <div className="grid w-full min-w-0 gap-2 sm:grid-cols-2 xl:max-w-5xl xl:grid-cols-[minmax(12rem,1fr)_10rem_10rem_auto_auto]">
              <label className="grid min-w-0 gap-1 text-sm font-medium text-text-muted">
                Search plugins
                <input
                  className="focus-ring min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-text"
                  placeholder="name, route, MCP tool, surface"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-medium text-text-muted">
                Visibility
                <select
                  className="focus-ring min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-text"
                  value={visibility}
                  onChange={(event) => setVisibility(event.currentTarget.value as PluginVisibilityFilter)}
                >
                  <option value="all">All plugins</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                  <option value="unhealthy">Needs attention</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-medium text-text-muted">
                Surface
                <select
                  className="focus-ring min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-text"
                  value={surface}
                  onChange={(event) => setSurface(event.currentTarget.value as PluginSurfaceFilter)}
                >
                  <option value="all">All surfaces</option>
                  {selectedSurfaceMissing ? <option value={surface}>{surface}</option> : null}
                  {surfaceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <button
                className="focus-ring self-end rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text hover:border-[oklch(1_0_0/0.12)] disabled:opacity-40"
                disabled={!hasFilters}
                type="button"
                onClick={() => { setQuery(''); setVisibility('all'); setSurface('all'); }}
              >
                Clear filters
              </button>
              <a className="focus-ring self-end rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent hover:border-accent-border" href={pluginInventoryPath({ q: query, visibility, surface })}>
                Share view
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {visiblePlugins.length ? (
        <PluginList plugins={visiblePlugins} enabledState={enabledState} onToggle={(name) => void togglePlugin(name)} />
      ) : plugins.length && showInventory ? (
        <p className="rounded-lg border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-5 text-sm text-text-muted">
          No plugins match the current filters. Clear filters or reload plugin manifests.
        </p>
      ) : showInventory ? (
        <p className="rounded-lg border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-5 text-sm text-text-muted">
          No installed plugins returned by {endpoint}.
        </p>
      ) : null}
    </section>
  );
}
