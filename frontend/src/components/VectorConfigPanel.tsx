import { useEffect, useState } from 'react';
import { fetchVectorConfig, reloadVectorConfig, updateVectorCollection } from '../api';
import { ErrorMessage, Spinner } from './AsyncState';
import type { VectorConfigResponse } from '../types';

const ADAPTERS = ['lancedb', 'qdrant', 'chroma', 'sqlite-vec'] as const;

type SaveState = Record<string, 'idle' | 'saving'>;

function statusClass(status: string) {
  if (status === 'ok') return 'border-emerald-400/30 text-emerald-200';
  if (status === 'disabled') return 'border-slate-600 text-slate-400';
  return 'border-rose-400/30 text-rose-200';
}

export function VectorConfigPanel() {
  const [state, setState] = useState<VectorConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<SaveState>({});

  async function load() {
    setError('');
    setLoading(true);
    try {
      setState(await fetchVectorConfig());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function patchCollection(key: string, patch: { adapter?: string; enabled?: boolean }) {
    setSaving((current) => ({ ...current, [key]: 'saving' }));
    setError('');
    try {
      await updateVectorCollection(key, patch);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving((current) => ({ ...current, [key]: 'idle' }));
    }
  }

  async function reload() {
    setError('');
    setLoading(true);
    try {
      await reloadVectorConfig();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    }
  }

  const rows = state ? Object.entries(state.config.collections) : [];

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-label="Vector backend config">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">Vector config</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Backend state</h3>
          <p className="mt-2 text-sm text-slate-400">Switch adapters, enable collections, and reload cached vector stores.</p>
        </div>
        <button className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" type="button" onClick={reload}>
          {loading ? <Spinner label="Reloading" /> : 'Reload vector config'}
        </button>
      </div>

      {error ? <div className="mt-4"><ErrorMessage title="Vector config update failed." message={error} /></div> : null}

      <div className="mt-5 grid gap-3">
        {rows.map(([key, item]) => {
          const health = state?.health[key];
          const enabled = item.enabled !== false;
          const status = health?.status ?? (enabled ? 'unknown' : 'disabled');
          return (
            <article key={key} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm text-teal-200">{key}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(status)}`}>{status}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-100">{item.collection}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.provider} · {item.model} · {state?.doc_counts[key] ?? 0} docs</p>
                  {health?.error ? <p className="mt-2 text-xs text-rose-300">{health.error}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Adapter
                    <select
                      className="mt-1 block rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      value={item.adapter ?? 'lancedb'}
                      onChange={(event) => void patchCollection(key, { adapter: event.target.value })}
                    >
                      {ADAPTERS.map((adapter) => <option key={adapter} value={adapter}>{adapter}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => void patchCollection(key, { enabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                  {saving[key] === 'saving' ? <Spinner label="Saving" /> : null}
                </div>
              </div>
            </article>
          );
        })}
        {!loading && rows.length === 0 ? <p className="text-sm text-slate-500">No vector collections configured.</p> : null}
      </div>
    </section>
  );
}
