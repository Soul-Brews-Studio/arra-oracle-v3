import { useEffect, useMemo, useState } from 'react';
import { apiClient, type ApiClient } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { pluginInventoryPath } from '../routePaths';
import type { HealthResponse } from '../../../src/server/types';

type PageState = 'loading' | 'ready' | 'error';
type StatusClient = Pick<ApiClient, 'health'> & Partial<Pick<ApiClient, 'vectorHealth'>>;
type VectorHealthForStatus = Awaited<ReturnType<ApiClient['vectorHealth']>> & { services?: VectorProxyService[] };
type VectorProxyService = {
  name: string;
  type?: string;
  endpoint?: string;
  status?: string;
  available?: boolean;
  health?: { status?: string; error?: string; checkedAt?: string };
};

export interface StatusPageProps {
  client?: StatusClient;
  initialHealth?: HealthResponse | null;
  initialVectorHealth?: VectorHealthForStatus | null;
}

function statusClass(status?: string): string {
  const normalized = status?.toLowerCase();
  if (normalized === 'ok' || normalized === 'connected' || normalized === 'healthy' || normalized === 'up') return 'border-ok-border bg-ok-bg text-ok-text';
  if (normalized === 'degraded' || normalized === 'draining' || normalized === 'starting') return 'border-warn-border bg-warn-bg text-warn-text';
  return 'border-err-border bg-err-bg text-err-text';
}

function rawSeconds(value: HealthResponse['uptime'] | undefined): number | undefined {
  if (typeof value === 'number') return value;
  return value?.seconds;
}

function healthUptimeSeconds(health: HealthResponse | null): number | undefined {
  return health?.uptimeSeconds ?? rawSeconds(health?.uptimeSecondsBreakdown) ?? rawSeconds(health?.uptime);
}

function formatSeconds(seconds?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'unknown';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}


function databaseStatus(health: HealthResponse): string | undefined {
  return health.subsystems?.database?.status ?? health.subsystems?.db?.status ?? health.dbStatus ?? health.db;
}

function subsystemStatus(health: HealthResponse, name: 'vector' | 'plugins' | 'plugin', fallback?: string): string | undefined {
  return health.subsystems?.[name]?.status ?? fallback;
}

function subsystemDataString(health: HealthResponse, name: 'database' | 'db', key: string): string | undefined {
  const value = health.subsystems?.[name]?.data?.[key];
  return typeof value === 'string' ? value : undefined;
}

function databasePath(health: HealthResponse): string | undefined {
  return health.dbCheck?.path ?? subsystemDataString(health, 'database', 'path') ?? subsystemDataString(health, 'db', 'path');
}

function Field({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-muted p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{label}</dt>
      <dd className="mt-2 font-mono text-sm text-text">{value ?? 'unknown'}</dd>
    </div>
  );
}

function StatusBadge({ label, status }: { label: string; status?: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${statusClass(status)}`} data-contrast-badge>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{label}</p>
      <p className="mt-2 flex items-center gap-2 text-2xl font-semibold"><span aria-hidden="true">●</span>{status ?? 'unknown'}</p>
    </div>
  );
}

export function vectorProxyRows(vector: VectorHealthForStatus | null): Array<{ name: string; status: string; endpoint: string; detail: string }> {
  const services = (vector?.services ?? []).filter((service) => service.type === 'proxy');
  if (services.length) {
    return services.map((service) => ({
      name: service.name,
      status: service.health?.status ?? service.status ?? (service.available ? 'up' : 'unknown'),
      endpoint: service.endpoint ?? 'not configured',
      detail: service.health?.error ?? service.health?.checkedAt ?? 'proxy service registered',
    }));
  }
  return vector?.proxy ? [{
    name: 'VECTOR_URL',
    status: vector.status,
    endpoint: vector.proxy,
    detail: vector.error ?? `${vector.engines.length} local engines bypassed by proxy health check`,
  }] : [];
}

export function pluginHealthPath(plugin: { name: string; status?: string; error?: string }): string {
  const unhealthy = Boolean((plugin.status && plugin.status !== 'ok') || plugin.error);
  return pluginInventoryPath({ q: plugin.name, visibility: unhealthy ? 'unhealthy' : 'all' });
}

function PluginRows({ health }: { health: HealthResponse }) {
  const items = health.plugins?.items ?? [];
  if (!items.length) return <p className="text-sm text-text-muted">No plugin health rows returned.</p>;
  return (
    <ul className="grid gap-2">
      {items.map((plugin) => (
        <li key={plugin.name} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between">
          <a className="focus-ring font-mono text-sm text-accent hover:text-accent" href={pluginHealthPath(plugin)}>{plugin.name}</a>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${statusClass(plugin.status)}`} data-contrast-badge><span aria-hidden="true">●</span>{plugin.status}</span>
          {plugin.error ? <span className="text-sm text-warn-text">{plugin.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function ProxyRows({ vector }: { vector: VectorHealthForStatus | null }) {
  const rows = vectorProxyRows(vector);
  if (!rows.length) return <p className="text-sm text-text-muted">No proxy service rows returned by /api/v1/vector/health.</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((row) => (
        <li key={`${row.name}-${row.endpoint}`} className="rounded-xl border border-border bg-surface-muted p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono text-sm text-accent">{row.name}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${statusClass(row.status === 'up' ? 'ok' : row.status)}`} data-contrast-badge><span aria-hidden="true">●</span>{row.status}</span>
          </div>
          <p className="mt-2 break-words font-mono text-xs text-text-muted">{row.endpoint}</p>
          <p className="mt-1 text-sm text-text-muted">{row.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function StatusPage({ client = apiClient, initialHealth = null, initialVectorHealth = null }: StatusPageProps) {
  const [state, setState] = useState<PageState>(initialHealth ? 'ready' : 'loading');
  const [health, setHealth] = useState<HealthResponse | null>(initialHealth);
  const [vectorHealth, setVectorHealth] = useState<VectorHealthForStatus | null>(initialVectorHealth);
  const [error, setError] = useState('');
  const [vectorError, setVectorError] = useState('');

  useEffect(() => {
    if (initialHealth) return;
    let cancelled = false;
    setState('loading');
    setError('');
    setVectorError('');
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
    client.vectorHealth?.()
      .then((response) => { if (!cancelled) setVectorHealth(response as VectorHealthForStatus); })
      .catch((cause) => { if (!cancelled) setVectorError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [client, initialHealth]);

  const uptime = useMemo(() => formatSeconds(healthUptimeSeconds(health)), [health]);
  const isLoading = state === 'loading';

  return (
    <section className="grid gap-5" aria-labelledby="status-page-title">
      <div className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Server status</p>
        <h2 id="status-page-title" className="mt-2 text-2xl font-semibold text-text">Health overview</h2>
        <p className="mt-2 text-sm text-text-muted">Live health from GET /api/v1/health.</p>
      </div>

      {isLoading ? <LoadingPanel title="Loading server health…" detail="Fetching /api/v1/health from the Elysia backend." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load server health." message={error} /> : null}

      {health && state === 'ready' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatusBadge label="Server" status={health.healthStatus ?? health.state ?? health.status} />
            <StatusBadge label="Database" status={databaseStatus(health)} />
            <StatusBadge label="Vector" status={subsystemStatus(health, 'vector', health.vectorStatus ?? health.vector?.status)} />
            <StatusBadge label="Plugins" status={subsystemStatus(health, 'plugins', health.pluginStatus ?? health.plugins?.status)} />
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Name" value={health.server} />
            <Field label="Version" value={health.version} />
            <Field label="Port" value={health.port} />
            <Field label="Uptime" value={uptime} />
            <Field label="MCP tools" value={health.mcpToolCount ?? health.mcp?.toolCount} />
            <Field label="Plugins" value={health.pluginCount ?? health.plugins?.count} />
            <Field label="Oracle" value={health.oracle} />
            <Field label="DB path" value={databasePath(health)} />
          </dl>
          <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-label="Plugin health rows">
            <h3 className="text-lg font-semibold text-text">Plugin health</h3>
            <div className="mt-4"><PluginRows health={health} /></div>
          </section>
          <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-label="Proxy status rows">
            <h3 className="text-lg font-semibold text-text">Proxy status</h3>
            <p className="mt-2 text-sm text-text-muted">Vector proxy and registered proxy services from /api/v1/vector/health.</p>
            {vectorError ? <p className="mt-3 rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn-text">{vectorError}</p> : null}
            <div className="mt-4"><ProxyRows vector={vectorHealth} /></div>
          </section>
        </>
      ) : null}
    </section>
  );
}
