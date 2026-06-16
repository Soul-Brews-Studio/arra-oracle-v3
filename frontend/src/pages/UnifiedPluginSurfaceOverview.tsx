import { useEffect, useMemo, useState } from 'react';
import { fetchMcpTools, fetchMenu, fetchSettingsSystem, fetchVectorConfig } from '../api';
import { apiClient } from '../api/client';
import { surfacesFor } from '../plugin-surfaces';
import { mcpToolPath, pluginInventoryPath } from '../routePaths';
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
type SurfaceListItem = string | { label: string; href: string };

function countBySurface(plugins: PluginEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const plugin of plugins) {
    const surfaces = surfacesFor(plugin);
    for (const surface of surfaces.length ? surfaces : ['metadata']) counts[surface] = (counts[surface] ?? 0) + 1;
  }
  return counts;
}

function surfaceCountLinks(counts: Record<string, number>): Array<{ label: string; href: string }> {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([surface, count]) => ({ label: `${surface} ${count}`, href: pluginInventoryPath({ surface }) }));
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
  return pluginCapabilityLinks(plugins).map((item) => item.label);
}

export function pluginCapabilityLinks(plugins: PluginEntry[]): Array<{ label: string; href: string }> {
  return plugins.flatMap((plugin) => [
    ...(plugin.apiRoutes ?? []).map((route) => ({
      label: `${plugin.name} api ${route.methods?.join('|') ?? 'ALL'} ${route.path}`,
      href: pluginInventoryPath({ q: route.path, surface: 'apiRoutes' }),
    })),
    ...(plugin.mcpTools ?? []).map((tool) => ({
      label: `${plugin.name} mcp ${tool.name}${tool.readOnly ? ' read-only' : ''}`,
      href: mcpToolPath(tool.name),
    })),
    ...(plugin.cliSubcommands ?? []).map((command) => ({
      label: `${plugin.name} cli ${command.command}`,
      href: pluginInventoryPath({ q: command.command, surface: 'cliSubcommands' }),
    })),
    ...(plugin.exportFormats ?? []).map((format) => ({
      label: `${plugin.name} export ${format.extension}`,
      href: pluginInventoryPath({ q: format.extension, surface: 'exportFormats' }),
    })),
    ...(plugin.proxy ?? []).map((proxy) => ({
      label: `${plugin.name} proxy ${proxy.path}`,
      href: pluginInventoryPath({ q: proxy.path, surface: 'proxy' }),
    })),
  ]);
}

export function pluginServerRows(plugins: PluginEntry[]): Array<{ name: string; status: string; health: string; surface: 'server' | 'proxy' }> {
  return plugins
    .filter((plugin) => plugin.server || plugin.proxy?.length)
    .map((plugin) => ({
      name: plugin.name,
      status: plugin.status ?? 'ok',
      health: plugin.server?.healthPath ?? plugin.proxy?.[0]?.path ?? 'proxy route',
      surface: plugin.server ? 'server' : 'proxy',
    }));
}

export function pluginServerLinks(plugins: PluginEntry[]): Array<{ label: string; href: string }> {
  return pluginServerRows(plugins).map((server) => ({
    label: `${server.name} · ${server.status} · ${server.health}`,
    href: pluginInventoryPath({ q: server.name, surface: server.surface }),
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
  const countLinks = useMemo(() => surfaceCountLinks(counts), [counts]);
  const servers = useMemo(() => pluginServerLinks(plugins), [plugins]);
  const capabilities = useMemo(() => pluginCapabilityLinks(plugins), [plugins]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="unified-surfaces-title">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Unified backend surfaces</p>
          <h3 id="unified-surfaces-title" className="mt-2 text-xl font-semibold text-white">Plugin system map</h3>
          <p className="mt-2 text-sm text-slate-400">Menu, plugin list, MCP tools, vector search, server health, and storage config in one view.</p>
        </div>
        {countLinks.length ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {countLinks.map((item) => <a key={item.href} className="focus-ring rounded-full border border-white/10 px-2 py-1 text-slate-300 hover:border-teal-300/40" href={item.href}>{item.label}</a>)}
          </div>
        ) : <p className="text-sm text-slate-500">metadata only</p>}
      </div>
      {error ? <p className="mb-3 text-sm text-amber-200">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map((card) => <SurfaceCard key={card.label} card={card} />)}</div>
      <div className="mt-4 grid gap-3 xl:grid-cols-5">
        <SurfaceList title="Menu items" items={state.menu.slice(0, 5).map((item) => ({ label: `${item.label} → ${item.path}`, href: item.path }))} empty="No /api/menu items loaded yet." />
        <SurfaceList title="MCP tools" items={state.tools.slice(0, 5).map((tool) => ({ label: `${tool.name}${tool.plugin ? ` · ${tool.plugin}` : ''}`, href: mcpToolPath(tool.name) }))} empty="No /api/mcp/tools entries loaded yet." />
        <SurfaceList title="Plugin servers" items={servers} empty="No plugin server or proxy surfaces." />
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

function SurfaceList({ title, items, empty }: { title: string; items: SurfaceListItem[]; empty: string }) {
  const visible = items.filter(Boolean);
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      {visible.length ? (
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {visible.map((item) => (
            <li key={typeof item === 'string' ? item : `${item.href}:${item.label}`} className="truncate font-mono">
              {typeof item === 'string' ? item : <a className="focus-ring text-teal-100 hover:text-teal-200" href={item.href}>{item.label}</a>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-slate-500">{empty}</p>}
    </article>
  );
}
