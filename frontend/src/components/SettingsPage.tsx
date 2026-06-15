import { useEffect, useMemo, useState } from 'react';
import { fetchSettingsSystem } from '../api';
import type { SettingsEmbedderCollection, SettingsSystemResponse } from '../types';

type LoadState = 'loading' | 'ready' | 'error';

type Row = { label: string; value: string | number | null | undefined };

function valueText(value: Row['value']): string {
  if (value === null || value === undefined || value === '') return 'not set';
  return String(value);
}

function InfoList({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-3 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">{row.label}</dt>
          <dd className="mt-1 break-all font-mono text-slate-200">{valueText(row.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ok = status === 'current' || status === 'drizzle-sqlite' || status === 'none';
  const classes = ok ? 'border-teal-300/20 bg-teal-300/10 text-teal-200' : 'border-amber-300/20 bg-amber-300/10 text-amber-100';
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${classes}`}>{status}</span>;
}

function CollectionList({ collections }: { collections: SettingsEmbedderCollection[] }) {
  if (!collections.length) return <p className="text-sm text-slate-500">No vector collections configured.</p>;
  return (
    <div className="grid gap-2">
      {collections.map((item) => (
        <div key={item.key} className="rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-teal-200">{item.key}</span>
            {item.primary ? <span className="rounded-full bg-teal-300/10 px-2 py-0.5 text-xs text-teal-200">primary</span> : null}
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">{item.adapter ?? 'adapter?'}</span>
          </div>
          <p className="mt-2 break-all text-slate-400">{item.collection}</p>
          <p className="mt-1 font-mono text-xs text-slate-500">{item.model} · provider {item.provider}</p>
        </div>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<SettingsSystemResponse | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setState('loading');
    setError('');
    try {
      setData(await fetchSettingsSystem());
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const storageRows = useMemo(() => data ? [
    { label: 'active backend', value: data.storage.activeBackend },
    { label: 'configured backend', value: data.storage.configuredBackend },
    { label: 'database path', value: data.storage.dbPath },
    { label: 'data directory', value: data.storage.dataDir },
    { label: 'repo root', value: data.storage.repoRoot },
  ] : [], [data]);

  const embedderRows = useMemo(() => data ? [
    { label: 'config source', value: data.embedder.source },
    { label: 'backend', value: data.embedder.backend },
    { label: 'model', value: data.embedder.model },
    { label: 'remote url', value: data.embedder.url },
    { label: 'dimensions', value: data.embedder.dimensions },
    { label: 'embedding endpoint', value: data.embedder.embeddingEndpoint },
  ] : [], [data]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="settings-title">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Runtime</p>
          <h2 id="settings-title" className="mt-2 text-3xl font-semibold text-white">Settings</h2>
          <p className="mt-2 text-sm text-slate-400">Storage, embedder, and Drizzle migration status from the backend.</p>
        </div>
        <button className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" type="button" onClick={() => void load()}>
          Refresh settings
        </button>
      </div>

      {state === 'loading' ? <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-400">Loading settings…</p> : null}
      {state === 'error' ? <p className="rounded-xl border border-red-400/30 bg-red-950/40 p-4 text-sm text-red-100">{error}</p> : null}

      {data ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold text-white">Storage backend</h3>
              <StatusBadge status={data.storage.activeBackend} />
            </div>
            <InfoList rows={storageRows} />
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold text-white">Embedder</h3>
              <StatusBadge status={data.embedder.backend} />
            </div>
            <InfoList rows={embedderRows} />
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold text-white">DB migrations</h3>
              <StatusBadge status={data.migrations.status} />
            </div>
            <InfoList rows={[
              { label: 'table present', value: data.migrations.tablePresent ? 'yes' : 'no' },
              { label: 'applied', value: data.migrations.appliedCount },
              { label: 'available', value: data.migrations.availableCount },
              { label: 'pending', value: data.migrations.pendingCount },
              { label: 'latest known', value: data.migrations.latestKnown },
              { label: 'latest applied at', value: data.migrations.latestAppliedAt },
            ]} />
          </section>
          <section className="space-y-4 xl:col-span-3">
            <h3 className="text-xl font-semibold text-white">Vector collections</h3>
            <CollectionList collections={data.embedder.collections} />
          </section>
        </div>
      ) : null}
    </section>
  );
}
