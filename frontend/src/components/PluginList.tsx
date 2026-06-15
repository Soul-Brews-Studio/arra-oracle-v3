import { surfacesFor } from '../plugin-surfaces';
import type { PluginEntry } from '../types';
import { Badge } from './Badge';
import { EmptyState } from './EmptyState';

export function PluginList({ plugins }: { plugins: PluginEntry[] }) {
  if (!plugins.length) return <EmptyState text="No plugins registered in /api/plugins." />;

  return (
    <div className="grid gap-4">
      {plugins.map((plugin) => {
        const surfaces = surfacesFor(plugin);
        return (
          <article key={plugin.name} className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{plugin.name}</h3>
                <p className="mt-1 text-sm text-slate-400">{plugin.description ?? 'No description supplied.'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {surfaces.length ? surfaces.map((surface) => <Badge key={surface}>{surface}</Badge>) : <Badge>metadata</Badge>}
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Version</dt>
                <dd className="font-mono text-slate-200">{plugin.version ?? 'unknown'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Artifact</dt>
                <dd className="font-mono text-slate-200">{plugin.file || 'server-only'}</dd>
              </div>
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
