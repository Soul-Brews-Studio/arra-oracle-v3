export type VectorProviderHealthCard = { type: string; status: 'green' | 'red'; available: boolean; detail?: string };
export type VectorStorageHealthCard = { adapter: string; status: 'green' | 'red'; healthy: number; total: number; detail?: string };
export type VectorServiceHealthCard = {
  name: string;
  type: string;
  endpoint?: string;
  status: 'green' | 'yellow' | 'red';
  available: boolean;
  health?: { status?: string; error?: string; checkedAt?: string };
};
export type VectorFreshnessCard = {
  status: 'fresh' | 'empty' | 'stale';
  totalIndexed: number;
  sourceDocs?: number;
  docsPending?: number;
  lastIndexed?: string;
};

function statusClasses(healthy: boolean): string {
  return healthy
    ? 'border-ok-border bg-ok-bg text-ok-text'
    : 'border-err-border bg-err-bg text-err-text';
}

function freshnessLine(freshness: VectorFreshnessCard): string {
  return `${freshness.status} · ${freshness.totalIndexed.toLocaleString()} indexed`;
}

function pendingLine(freshness?: VectorFreshnessCard): string {
  if (!freshness || typeof freshness.docsPending !== 'number') return 'Pending count unavailable';
  const source = typeof freshness.sourceDocs === 'number' ? ` of ${freshness.sourceDocs.toLocaleString()} source docs` : '';
  return `${freshness.docsPending.toLocaleString()} pending${source}`;
}

function serviceDetail(service: VectorServiceHealthCard): string {
  const health = service.health?.status ?? (service.available ? 'up' : 'unknown');
  const error = service.health?.error ? ` · ${service.health.error}` : '';
  return `${service.name}: ${health}${error}`;
}

export function VectorHealthDashboardCard({
  providers = [],
  services = [],
  storage = [],
  freshness,
}: {
  providers?: VectorProviderHealthCard[];
  services?: VectorServiceHealthCard[];
  storage?: VectorStorageHealthCard[];
  freshness?: VectorFreshnessCard;
}) {
  const providerSummary = providers.length
    ? `${providers.filter((item) => item.available).length}/${providers.length} providers available`
    : 'Provider detection unavailable';
  const serviceSummary = services.length
    ? `${services.filter((item) => item.available).length}/${services.length} services up`
    : 'Service registry unavailable';
  const storageSummary = storage.length
    ? `${storage.filter((item) => item.status === 'green').length}/${storage.length} storage backends healthy`
    : 'Storage status unavailable';
  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="vector-health-dashboard-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Health</p>
      <h2 id="vector-health-dashboard-title" className="mt-2 text-2xl font-semibold text-text">Vector health dashboard</h2>
      <dl className="mt-4 grid gap-3 text-sm text-text-muted">
        <div><dt className="text-text-muted">Embedding providers</dt><dd className="text-lg font-semibold text-text">{providerSummary}</dd></div>
        <div><dt className="text-text-muted">Registered services</dt><dd className="text-lg font-semibold text-text">{serviceSummary}</dd></div>
        <div><dt className="text-text-muted">Storage backends</dt><dd className="text-lg font-semibold text-text">{storageSummary}</dd></div>
        <div><dt className="text-text-muted">Index freshness</dt><dd className="text-lg font-semibold text-text">{freshness ? freshnessLine(freshness) : 'Unknown'}</dd></div>
        <div><dt className="text-text-muted">Docs pending</dt><dd className="text-lg font-semibold text-text">{pendingLine(freshness)}</dd></div>
        <div><dt className="text-text-muted">Last indexed</dt><dd className="text-lg font-semibold text-text">{freshness?.lastIndexed ?? 'Unknown'}</dd></div>
      </dl>
      {providers.length ? <div className="mt-4 flex flex-wrap gap-2">{providers.map((provider) => <span key={provider.type} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${statusClasses(provider.available)}`}><span aria-hidden="true">●</span>{provider.type}: {provider.status}</span>)}</div> : null}
      {services.length ? <div className="mt-2 flex flex-wrap gap-2">{services.map((service) => <span key={service.name} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${statusClasses(service.status === 'green')}`}><span aria-hidden="true">●</span>{serviceDetail(service)}</span>)}</div> : null}
      {storage.length ? <div className="mt-2 flex flex-wrap gap-2">{storage.map((item) => <span key={item.adapter} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${statusClasses(item.status === 'green')}`}><span aria-hidden="true">●</span>{item.adapter}: {item.healthy}/{item.total}</span>)}</div> : null}
    </section>
  );
}
