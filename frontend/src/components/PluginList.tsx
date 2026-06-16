import { surfacesFor } from '../plugin-surfaces';
import type { PluginEntry } from '../types';
import { Badge } from './Badge';
import { EmptyState } from './EmptyState';

export type PluginEnabledState = Record<string, boolean>;

export function isPluginEnabled(plugin: PluginEntry, state: PluginEnabledState = {}): boolean {
  if (plugin.name in state) return state[plugin.name] ?? true;
  if (typeof plugin.enabled === 'boolean') return plugin.enabled;
  return plugin.status !== 'disabled';
}

export function pluginStatusLabel(plugin: PluginEntry, enabled: boolean): string {
  if (!enabled) return 'disabled';
  return plugin.status || 'ok';
}

export function pluginHealthLabel(plugin: PluginEntry, enabled: boolean): string {
  if (!enabled) return 'inactive';
  if (plugin.error) return 'unhealthy';
  if (plugin.status === 'degraded') return 'degraded';
  if (plugin.status && plugin.status !== 'ok') return plugin.status;
  return 'healthy';
}

export function togglePluginEnabled(state: PluginEnabledState, name: string): PluginEnabledState {
  return { ...state, [name]: !(state[name] ?? true) };
}

type SurfaceRow = { label: string; value: string };

function routeLabel(methods: string[] | undefined, path: string): string {
  return `${methods?.length ? methods.join('|') : 'ANY'} ${path}`;
}

export function pluginSurfaceRows(plugin: PluginEntry): SurfaceRow[] {
  const rows: SurfaceRow[] = [];
  if (plugin.menu) rows.push({ label: 'Menu entry', value: [plugin.menu.label, plugin.menu.path].filter(Boolean).join(' · ') });
  if (plugin.server) {
    rows.push({
      label: 'Server',
      value: `${plugin.server.command} ${(plugin.server.args ?? []).join(' ')} · ${plugin.server.healthPath ?? '/health'}`,
    });
  }
  if (plugin.mcpTools?.length) {
    rows.push({ label: 'MCP tools', value: plugin.mcpTools.map((tool) => tool.name).join(', ') });
  }
  if (plugin.apiRoutes?.length) {
    rows.push({ label: 'API routes', value: plugin.apiRoutes.map((route) => routeLabel(route.methods, route.path)).join(', ') });
  }
  if (plugin.proxy?.length) {
    rows.push({
      label: 'Proxy routes',
      value: plugin.proxy.map((proxy) => `${routeLabel(proxy.methods, proxy.path)} → $${proxy.targetEnv}`).join(', '),
    });
  }
  if (plugin.cliSubcommands?.length) {
    rows.push({ label: 'CLI subcommands', value: plugin.cliSubcommands.map((command) => command.command).join(', ') });
  }
  if (plugin.exportFormats?.length) {
    rows.push({ label: 'Export formats', value: plugin.exportFormats.map((format) => `.${format.extension}`).join(', ') });
  }
  return rows;
}

export function PluginList({
  plugins,
  enabledState = {},
  onToggle,
}: {
  plugins: PluginEntry[];
  enabledState?: PluginEnabledState;
  onToggle?: (name: string) => void;
}) {
  if (!plugins.length) return <EmptyState text="No plugins registered in /api/plugins." />;

  return (
    <div className="grid gap-4">
      {plugins.map((plugin) => {
        const surfaces = surfacesFor(plugin);
        const enabled = isPluginEnabled(plugin, enabledState);
        const status = pluginStatusLabel(plugin, enabled);
        const health = pluginHealthLabel(plugin, enabled);
        const surfaceRows = pluginSurfaceRows(plugin);
        return (
          <article key={plugin.name} className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{plugin.name}</h3>
                <p className="mt-1 text-sm text-slate-400">{plugin.description ?? 'No description supplied.'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{status}</Badge>
                <Badge>{health}</Badge>
                {surfaces.length
                  ? surfaces.map((surface) => <Badge key={surface}>{surface}</Badge>)
                  : <Badge>metadata</Badge>}
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Version</dt>
                <dd className="font-mono text-slate-200">{plugin.version ?? 'unknown'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="font-mono text-slate-200">{status}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Health</dt>
                <dd className="font-mono text-slate-200">{health}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Artifact</dt>
                <dd className="font-mono text-slate-200">{plugin.file || 'server-only'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Admin</dt>
                <dd>
                  <button
                    aria-label={`${enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                    aria-pressed={enabled}
                    className="focus-ring rounded-lg border border-teal-300/30 px-3 py-2 font-semibold text-teal-100 transition hover:bg-teal-300/10"
                    type="button"
                    onClick={() => onToggle?.(plugin.name)}
                  >
                    {enabled ? 'Disable' : 'Enable'}
                  </button>
                </dd>
              </div>
              {plugin.error ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Error</dt>
                  <dd className="text-amber-200">{plugin.error}</dd>
                </div>
              ) : null}
              {surfaceRows.length ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Surface details</dt>
                  <dd className="mt-2 grid gap-2">
                    {surfaceRows.map((row) => (
                      <span key={`${row.label}:${row.value}`} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-slate-200">
                        <span className="font-sans text-slate-500">{row.label}: </span>{row.value}
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </article>
        );
      })}
    </div>
  );
}
