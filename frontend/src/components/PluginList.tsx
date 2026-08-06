import { surfacesFor } from '../plugin-surfaces';
import { mcpToolsPath, pluginInventoryPath } from '../routePaths';
import type { PluginEntry } from '../types';
import { Badge, badgeToneForStatus } from './Badge';
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

export function pluginSurfaceBadgePath(pluginName: string, surface: string): string {
  return pluginInventoryPath({ q: pluginName, surface });
}

type SurfaceRow = { label: string; value: string; href: string };

function routeLabel(methods: string[] | undefined, path: string): string {
  const safeMethods = Array.isArray(methods) ? methods : [];
  return `${safeMethods.length ? safeMethods.join('|') : 'ANY'} ${path}`;
}

export function pluginSurfaceRows(plugin: PluginEntry): SurfaceRow[] {
  const rows: SurfaceRow[] = [];
  if (plugin.menu) {
    rows.push({
      label: 'Menu entry',
      value: [plugin.menu.label, plugin.menu.path].filter(Boolean).join(' · '),
      href: plugin.menu.path ?? pluginSurfaceBadgePath(plugin.name, 'menu'),
    });
  }
  if (plugin.server) {
    rows.push({
      label: 'Server',
      value: `${plugin.server.command} ${(plugin.server.args ?? []).join(' ')} · ${plugin.server.healthPath ?? '/health'}`,
      href: pluginSurfaceBadgePath(plugin.name, 'server'),
    });
  }
  if (Array.isArray(plugin.mcpTools) && plugin.mcpTools.length) {
    rows.push({ label: 'MCP tools', value: plugin.mcpTools.map((tool) => tool.name).join(', '), href: mcpToolsPath({ q: plugin.name, source: 'plugin' }) });
  }
  if (Array.isArray(plugin.apiRoutes) && plugin.apiRoutes.length) {
    rows.push({ label: 'API routes', value: plugin.apiRoutes.map((route) => routeLabel(route.methods, route.path)).join(', '), href: pluginSurfaceBadgePath(plugin.name, 'apiRoutes') });
  }
  if (Array.isArray(plugin.proxy) && plugin.proxy.length) {
    rows.push({
      label: 'Proxy routes',
      value: plugin.proxy.map((proxy) => `${routeLabel(proxy.methods, proxy.path)} → $${proxy.targetEnv}`).join(', '),
      href: pluginSurfaceBadgePath(plugin.name, 'proxy'),
    });
  }
  if (Array.isArray(plugin.cliSubcommands) && plugin.cliSubcommands.length) {
    rows.push({ label: 'CLI subcommands', value: plugin.cliSubcommands.map((command) => command.command).join(', '), href: pluginSurfaceBadgePath(plugin.name, 'cliSubcommands') });
  }
  if (Array.isArray(plugin.exportFormats) && plugin.exportFormats.length) {
    rows.push({ label: 'Export formats', value: plugin.exportFormats.map((format) => `.${format.extension}`).join(', '), href: pluginSurfaceBadgePath(plugin.name, 'exportFormats') });
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
          <article key={plugin.name} className="min-w-0 rounded-2xl border border-border bg-surface p-5">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-semibold text-text">{plugin.name}</h3>
                <p className="mt-1 break-words text-sm text-text-muted">{plugin.description ?? 'No description supplied.'}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge dot tone={badgeToneForStatus(status)}>{status}</Badge>
                <Badge dot tone={badgeToneForStatus(health)}>{health}</Badge>
                {surfaces.length
                  ? surfaces.map((surface) => (
                    <a key={surface} className="focus-ring rounded-full" href={pluginSurfaceBadgePath(plugin.name, surface)}>
                      <Badge tone="accent">{surface}</Badge>
                    </a>
                  ))
                  : (
                    <a className="focus-ring rounded-full" href={pluginSurfaceBadgePath(plugin.name, 'metadata')}>
                      <Badge tone="accent">metadata</Badge>
                    </a>
                  )}
              </div>
            </div>
            <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">Version</dt>
                <dd className="break-words font-mono text-text">{plugin.version ?? 'unknown'}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Status</dt>
                <dd className="font-mono text-text">{status}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Health</dt>
                <dd className="font-mono text-text">{health}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Artifact</dt>
                <dd className="break-all font-mono text-text">{plugin.file || 'server-only'}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Admin</dt>
                <dd>
                  <button
                    aria-label={`${enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                    aria-pressed={enabled}
                    className="focus-ring rounded-lg border border-accent-border px-3 py-2 font-semibold text-accent transition hover:bg-ok-bg"
                    type="button"
                    onClick={() => onToggle?.(plugin.name)}
                  >
                    {enabled ? 'Disable' : 'Enable'}
                  </button>
                </dd>
              </div>
              {plugin.error ? (
                <div className="sm:col-span-2">
                  <dt className="text-text-muted">Error</dt>
                  <dd className="break-words text-warn-text">{plugin.error}</dd>
                </div>
              ) : null}
              {surfaceRows.length ? (
                <div className="sm:col-span-2">
                  <dt className="text-text-muted">Surface details</dt>
                  <dd className="mt-2 grid gap-2">
                    {surfaceRows.map((row) => (
                      <a key={`${row.label}:${row.value}`} className="focus-ring min-w-0 break-words rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-text hover:border-teal-300/40" href={row.href}>
                        <span className="font-sans text-text-muted">{row.label}: </span>{row.value}
                      </a>
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
