import { useMemo, useState } from 'react';
import { ErrorMessage, Spinner } from './AsyncState';
import { ADAPTER_OPTIONS, type VectorConfigAdapter, type VectorConfigRow, fetchJson } from '../pages/vectorSettingsHelpers';

interface VectorAdapterSwitcherProps {
  rows: VectorConfigRow[];
  onRefresh: () => Promise<void> | void;
}

export function adapterStatus(rows: VectorConfigRow[]): string {
  if (!rows.length) return 'No vector collections configured.';
  const counts = new Map<VectorConfigAdapter, number>();
  let healthy = 0;
  for (const row of rows) {
    counts.set(row.adapter, (counts.get(row.adapter) ?? 0) + 1);
    if (row.health?.ok) healthy += 1;
  }
  const adapterText = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([adapter, count]) => `${adapter} ${count}`)
    .join(' · ');
  return `${rows.length} collections · ${adapterText} · ${healthy}/${rows.length} healthy`;
}

function currentAdapter(rows: VectorConfigRow[]): string {
  if (!rows.length) return 'none';
  const unique = new Set(rows.map((row) => row.adapter));
  return unique.size === 1 ? rows[0]?.adapter ?? 'none' : 'mixed';
}

function targetLabel(adapter: VectorConfigAdapter): string {
  return `Use ${adapter}`;
}

export function VectorAdapterSwitcher({ rows, onRefresh }: VectorAdapterSwitcherProps) {
  const [saving, setSaving] = useState<VectorConfigAdapter | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const summary = useMemo(() => adapterStatus(rows), [rows]);
  const activeAdapter = useMemo(() => currentAdapter(rows), [rows]);

  async function switchAdapter(adapter: VectorConfigAdapter) {
    const changedRows = rows.filter((row) => row.adapter !== adapter);
    setSaving(adapter);
    setMessage('');
    setError('');
    try {
      for (const row of changedRows) {
        await fetchJson(`/api/v1/vector/config/${encodeURIComponent(row.key)}`, {
          method: 'PUT',
          body: JSON.stringify({ adapter }),
        });
      }
      await fetchJson('/api/v1/vector/config/reload', { method: 'POST' });
      await onRefresh();
      setMessage(changedRows.length ? `Switched ${changedRows.length} collections to ${adapter}.` : `Already using ${adapter}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-adapter-switcher-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Adapter switcher</p>
          <h2 id="vector-adapter-switcher-title" className="mt-2 text-2xl font-semibold text-white">Vector backend adapter</h2>
          <p className="mt-2 text-sm text-slate-400">Switch all vector collections across built-in and proxy-capable adapters.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ADAPTER_OPTIONS.map((adapter) => (
            <button
              className="focus-ring rounded-xl border border-cyan-300/30 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={Boolean(saving) || !rows.length}
              key={adapter}
              type="button"
              onClick={() => void switchAdapter(adapter)}
            >
              {saving === adapter ? <Spinner label="Switching" /> : targetLabel(adapter)}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <dt className="text-slate-500">Current adapter</dt>
          <dd className="mt-1 text-lg font-semibold text-cyan-100">{activeAdapter}</dd>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <dt className="text-slate-500">Status</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-200">{summary}</dd>
        </div>
      </dl>

      {message ? <p className="mt-4 text-sm text-emerald-200">{message}</p> : null}
      {error ? <div className="mt-4"><ErrorMessage title="Adapter switch failed." message={error} /></div> : null}
    </section>
  );
}
