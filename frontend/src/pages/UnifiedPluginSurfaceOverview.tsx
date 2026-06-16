import { useEffect, useMemo, useState } from 'react';
import { fetchMcpTools, fetchMenu, fetchSettingsSystem, fetchVectorConfig } from '../api';
import { apiClient } from '../api/client';
import { surfacesFor } from '../plugin-surfaces';
import type { McpTool, MenuItem, PluginEntry, SettingsSystemResponse, VectorConfigResponse } from '../types';
import type { HealthResponse } from '../../../src/server/types';

type SurfaceState = {
  menu: MenuItem[];
  tools: McpTool[];
  settings: SettingsSystemResponse | null;
  vector: VectorConfigResponse | null;
  health: HealthResponse | null;
};

type Card = { label: string; value: string | number; detail: string; href: string; tone?: 'ok' | 'warn' };

function countBySurface(plugins: PluginEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const plugin of plugins) {
    const surfaces = surfacesFor(plugin);
    for (const surface of surfaces.length ? surfaces : ['metadata']) counts[surface] = (counts[surface] ?? 0) + 1;
  }
  return counts;
}

function formatPath(value?: string | null): string {
  if (!value) return 'not configured';
  return value.length > 42 ? `${value.slice(0, 39)}…` : value;
}

function buildCards(plugins: PluginEntry[], state: SurfaceState): Card[] {
  const vectorCollections = Object.keys(state.vector?.config.collections ?? {}).length;
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled !== false && plugin.status !== 'disabled').length;
  return [
    { label: 'Menu', value: state.menu.length, detail: 'Items from /api/menu across DB, custom, gist, frontend, and plugin sources.', href: '/menu' },
    { label: 'Plugins', value: plugins.length, detail: `${enabledPlugins} enabled · ${countBySurface(plugins).server ?? 0} server surfaces.`, href: '/plugins' },
    { label: 'MCP tools', value: state.tools.length, detail: `${state.tools.filter((tool) => tool.source === 'plugin').length} plugin tools exposed through MCP-out.`, href: '/mcp' },
    { label: 'Vector search', value: vectorCollections, detail: `${state.vector?.source ?? 'unknown'} config · ${Object.keys(state.vector?.health ?? {}).length} health entries.`, href: '/vector' },
    { label: 'Server status', value: state.health?.status ?? 'unknown', detail: `plugins ${state.health?.pluginStatus ?? 'unknown'} · vector ${state.health?.vectorStatus ?? 'unknown'}.`, href: '/status', tone: state.health?.status === 'ok' ? 'ok' : 'warn' },
    { label: 'Storage', value: state.settings?.storage.activeBackend ?? 'unknown', detail: `DB ${formatPath(state.settings?.storage.dbPath)}.`, href: '/storage' },
  ];
}


export function pluginCapabilityRows(plugins: PluginEntry[]): string[] {
  return plugins.flatMap((plugin) => [
    ...(plugin.apiRoutes ?? []).map((route) => `${plugin.name} api ${route.methods?.join('|') ?? 'ALL'} ${route.path}`),
    ...(plugin.mcpTools ?? []).map((tool) => `${plugin.name} mcp ${tool.name}${tool.readOnly ? ' read-only' : ''}`),
    ...(plugin.cliSubcommands ?? []).map((command) => `${plugin.name} cli ${command.command}`),
    ...(plugin.exportFormats ?? []).map((format) => `${plugin.name} export ${format.extension}`),
    ...(plugin.proxy ?? []).map((proxy) => `${plugin.name} proxy ${proxy.path}`),
  ]);
}

export function pluginServerRows(plugins: PluginEntry[]): Array<{ name: string; status: string; health: string }> {
  return plugins
    .filter((plugin) => plugin.server || plugin.proxy?.length)
    .map((plugin) => ({
      name: plugin.name,
      status: plugin.status ?? 'ok',
      health: plugin.server?.healthPath ?? plugin.proxy?.[0]?.path ?? 'proxy route',
    }));
}

export function UnifiedPluginSurfaceOverview({ plugins }: { plugins: PluginEntry[] }) {
  const [state, setState] = useState<SurfaceState>({ menu: [], tools: [], settings: null, vector: null, health: null });
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.allSettled([fetchMenu(), fetchMcpTools(), fetchSettingsSystem(), fetchVectorConfig(), apiClient.health()])
      .then(([menu, tools, settings, vector, health]) => {
        if (!active) return;
        setState({
          menu: menu.status === 'fulfilled' ? menu.value.items : [],
          tools: tools.status === 'fulfilled' ? tools.value.tools : [],
          settings: settings.status === 'fulfilled' ? settings.value : null,
          vector: vector.status === 'fulfilled' ? vector.value : null,
          health: health.status === 'fulfilled' ? health.value : null,
        });
        const failed = [menu, tools, settings, vector, health].filter((item) => item.status === 'rejected').length;
        setError(failed ? `${failed} surface request${failed === 1 ? '' : 's'} failed; showing partial data.` : '');
      });
    return () => { active = false; };
  }, []);

  const cards = useMemo(() => buildCards(plugins, state), [plugins, state]);
  const counts = useMemo(() => countBySurface(plugins), [plugins]);
  const servers = useMemo(() => pluginServerRows(plugins), [plugins]);
  const capabilities = useMemo(() => pluginCapabilityRows(plugins), [plugins]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="unified-surfaces-title">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Unified backend surfaces</p>
          <h3 id="unified-surfaces-title" className="mt-2 text-xl font-semibold text-white">Plugin system map</h3>
          <p className="mt-2 text-sm text-slate-400">Menu, plugin list, MCP tools, vector search, server health, and storage config in one view.</p>
        </div>
        <p className="text-sm text-slate-500">{Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'metadata only'}</p>
      </div>
      {error ? <p className="mb-3 text-sm text-amber-200">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map((card) => <SurfaceCard key={card.label} card={card} />)}</div>
      <div className="mt-4 grid gap-3 xl:grid-cols-5">
        <SurfaceList title="Menu items" items={state.menu.slice(0, 5).map((item) => `${item.label} → ${item.path}`)} empty="No /api/menu items loaded yet." />
        <SurfaceList title="MCP tools" items={state.tools.slice(0, 5).map((tool) => `${tool.name}${tool.plugin ? ` · ${tool.plugin}` : ''}`)} empty="No /api/mcp/tools entries loaded yet." />
        <SurfaceList title="Plugin servers" items={servers.map((server) => `${server.name} · ${server.status} · ${server.health}`)} empty="No plugin server or proxy surfaces." />
        <SurfaceList title="Capabilities" items={capabilities.slice(0, 6)} empty="No API, CLI, proxy, export, or MCP capabilities." />
        <SurfaceList title="Storage" items={[state.settings ? `${state.settings.storage.activeBackend} · ${formatPath(state.settings.storage.dbPath)}` : 'Storage config not loaded yet.']} empty="Storage config not loaded yet." />
      </div>
    </section>
  );
}

function SurfaceCard({ card }: { card: Card }) {
  const tone = card.tone === 'warn' ? 'text-amber-100' : 'text-teal-100';
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{card.value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{card.detail}</p>
      <a className="focus-ring mt-3 inline-flex text-sm font-semibold text-teal-200 hover:text-teal-100" href={card.href}>
        Open {card.label}
      </a>
    </article>
  );
}

function SurfaceList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  const visible = items.filter(Boolean);
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      {visible.length ? <ul className="mt-3 space-y-2 text-sm text-slate-300">{visible.map((item) => <li key={item} className="truncate font-mono">{item}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">{empty}</p>}
    </article>
  );
}
