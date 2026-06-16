import { useEffect, useMemo, useState } from 'react';
import { apiClient, type ApiClient } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import type { HealthResponse } from '../../../src/server/types';

type PageState = 'loading' | 'ready' | 'error';
type StatusClient = Pick<ApiClient, 'health'>;

export interface StatusPageProps {
  client?: StatusClient;
}

function statusClass(status?: string): string {
  if (status === 'ok' || status === 'connected') return 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100';
  if (status === 'degraded' || status === 'draining') return 'border-amber-300/30 bg-amber-300/10 text-amber-100';
  return 'border-red-300/30 bg-red-300/10 text-red-100';
}

function formatSeconds(seconds?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'unknown';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function Field({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="mt-2 font-mono text-sm text-slate-100">{value ?? 'unknown'}</dd>
    </div>
  );
}

function StatusBadge({ label, status }: { label: string; status?: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${statusClass(status)}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{status ?? 'unknown'}</p>
    </div>
  );
}

function PluginRows({ health }: { health: HealthResponse }) {
  const items = health.plugins?.items ?? [];
  if (!items.length) return <p className="text-sm text-slate-400">No plugin health rows returned.</p>;
  return (
    <ul className="grid gap-2">
      {items.map((plugin) => (
        <li key={plugin.name} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-mono text-sm text-slate-100">{plugin.name}</span>
          <span className={`rounded-full border px-2 py-1 text-xs ${statusClass(plugin.status)}`}>{plugin.status}</span>
          {plugin.error ? <span className="text-sm text-amber-200">{plugin.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function StatusPage({ client = apiClient }: StatusPageProps) {
  const [state, setState] = useState<PageState>('loading');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError('');
    client.health()
      .then((response) => {
        if (cancelled) return;
        setHealth(response);
        setState('ready');
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState('error');
      });
    return () => { cancelled = true; };
  }, [client]);

  const uptime = useMemo(() => formatSeconds(health?.uptimeSeconds ?? health?.uptime?.seconds), [health]);
  const isLoading = state === 'loading';

  return (
    <section className="grid gap-5" aria-labelledby="status-page-title">
      <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Server status</p>
        <h2 id="status-page-title" className="mt-2 text-2xl font-semibold text-white">Health overview</h2>
        <p className="mt-2 text-sm text-slate-400">Live health from GET /api/v1/health.</p>
      </div>

      {isLoading ? <LoadingPanel title="Loading server health…" detail="Fetching /api/v1/health from the Elysia backend." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load server health." message={error} /> : null}

      {health && state === 'ready' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatusBadge label="Server" status={health.status} />
            <StatusBadge label="Database" status={health.dbStatus ?? health.db?.status} />
            <StatusBadge label="Vector" status={health.vectorStatus ?? health.vector?.status} />
            <StatusBadge label="Plugins" status={health.pluginStatus ?? health.plugins?.status} />
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Name" value={health.server} />
            <Field label="Version" value={health.version} />
            <Field label="Port" value={health.port} />
            <Field label="Uptime" value={uptime} />
            <Field label="MCP tools" value={health.mcpToolCount ?? health.mcp?.toolCount} />
            <Field label="Plugins" value={health.pluginCount ?? health.plugins?.count} />
            <Field label="Oracle" value={health.oracle} />
            <Field label="DB path" value={health.db?.path} />
          </dl>
          <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-label="Plugin health rows">
            <h3 className="text-lg font-semibold text-white">Plugin health</h3>
            <div className="mt-4"><PluginRows health={health} /></div>
          </section>
        </>
      ) : null}
    </section>
  );
}
