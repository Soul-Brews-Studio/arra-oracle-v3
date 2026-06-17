import { useMemo, useState } from 'react';
import type { VectorService } from '../api/oracle';

type StorageBackend = 'lancedb' | 'qdrant' | 'turbovec' | 'cloudflare-vectorize';

const BACKENDS: Array<{ key: StorageBackend; label: string; detail: string }> = [
  { key: 'lancedb', label: 'LanceDB (built-in)', detail: 'Default local vector store.' },
  { key: 'qdrant', label: 'Qdrant (external)', detail: 'External vector database endpoint.' },
  { key: 'turbovec', label: 'TurboVec (external)', detail: 'Proxy or sidecar service endpoint.' },
  { key: 'cloudflare-vectorize', label: 'Cloudflare Vectorize', detail: 'Workers AI Vectorize index config.' },
];

function serviceCount(services: VectorService[]): number {
  return services.filter((service) => service.type === 'builtin' || service.health?.status === 'up').length;
}

export function VectorStorageSelector({ services }: { services: VectorService[] }) {
  const [backend, setBackend] = useState<StorageBackend>('lancedb');
  const [endpoint, setEndpoint] = useState('http://localhost:6333');
  const [accountId, setAccountId] = useState('');
  const [indexName, setIndexName] = useState('oracle-vectors');
  const activeServices = useMemo(() => serviceCount(services), [services]);

  return (
    <div className="rounded-2xl border border-border bg-surface-muted p-4">
      <h3 className="font-semibold text-accent">Storage Backend selector</h3>
      <p className="mt-1 text-sm text-text-muted">Choose a vector store target before registering or testing a service.</p>
      <div className="mt-3 grid gap-2">
        {BACKENDS.map((item) => (
          <label key={item.key} className="flex items-start gap-3 rounded-xl border border-border bg-surface-muted p-3 text-sm text-text">
            <input checked={backend === item.key} type="radio" onChange={() => setBackend(item.key)} />
            <span><span className="font-semibold text-text">{item.label}</span><br /><span className="text-text-muted">{item.detail}</span></span>
          </label>
        ))}
      </div>
      {backend === 'lancedb' ? <p className="mt-3 text-sm text-text-muted">Vector count available from {activeServices} healthy built-in/service registry entries.</p> : null}
      {backend === 'qdrant' || backend === 'turbovec' ? (
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
          Endpoint URL
          <input className="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        </label>
      ) : null}
      {backend === 'cloudflare-vectorize' ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Account ID<input className="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Vectorize index<input className="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={indexName} onChange={(event) => setIndexName(event.target.value)} /></label>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-muted">Use [+ Register Service] below to save a name, endpoint, and test the service.</p>
    </div>
  );
}
