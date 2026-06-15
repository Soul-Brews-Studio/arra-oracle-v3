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

export function togglePluginEnabled(state: PluginEnabledState, name: string): PluginEnabledState {
  return { ...state, [name]: !(state[name] ?? true) };
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
  if (!plugins.length) return <EmptyState text="No plugins registered in /api/v1/plugins." />;

  return (
    <div className="grid gap-4">
      {plugins.map((plugin) => {
        const surfaces = surfacesFor(plugin);
        const enabled = isPluginEnabled(plugin, enabledState);
        const status = pluginStatusLabel(plugin, enabled);
        return (
          <article key={plugin.name} className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{plugin.name}</h3>
                <p className="mt-1 text-sm text-slate-400">{plugin.description ?? 'No description supplied.'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{status}</Badge>
                {surfaces.length ? surfaces.map((surface) => <Badge key={surface}>{surface}</Badge>) : <Badge>metadata</Badge>}
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
              {plugin.server ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Server</dt>
                  <dd className="font-mono text-slate-200">
                    {plugin.server.command} {(plugin.server.args ?? []).join(' ')} · {plugin.server.healthPath ?? '/health'}
                  </dd>
                </div>
              ) : null}
              {plugin.mcpTools?.length ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">MCP tools</dt>
                  <dd className="font-mono text-slate-200">{plugin.mcpTools.length}</dd>
                </div>
              ) : null}
            </dl>
          </article>
        );
      })}
    </div>
  );
}
