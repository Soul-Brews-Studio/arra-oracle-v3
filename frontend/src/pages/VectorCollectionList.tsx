import { Spinner } from '../components/AsyncState';
import { ADAPTER_OPTIONS, type VectorConfigAdapter, type VectorConfigDraft, type VectorConfigRow } from './vectorSettingsHelpers';

interface CollectionListProps {
  rows: VectorConfigRow[];
  drafts: Record<string, VectorConfigDraft>;
  saving: Record<string, boolean>;
  testing: Record<string, boolean>;
  primarySaving: string;
  actionMessage: Record<string, string>;
  onDraft: (key: string, next: Partial<VectorConfigDraft>) => void;
  onSave: (key: string) => void;
  onTest: (key: string) => void;
  onPrimary: (key: string) => void;
}

function CollectionStatus({ row }: { row: VectorConfigRow }) {
  const ok = row.health?.ok;
  const label = row.health?.status ?? 'unknown';
  const classes = ok
    ? 'border-[color:var(--color-ok-text,#166534)] bg-[var(--color-ok-bg,#dcfce7)] text-[color:var(--color-ok-text,#166534)]'
    : 'border-[color:var(--color-err-text,#991b1b)] bg-[var(--color-err-bg,#fee2e2)] text-[color:var(--color-err-text,#991b1b)]';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${classes}`}><span aria-hidden="true">●</span>{label}</span>;
}

function PrimaryBadge({ primary }: { primary?: boolean }) {
  if (!primary) return null;
  return <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-ok-text,#166534)] bg-[var(--color-ok-bg,#dcfce7)] px-2 py-1 text-xs text-[color:var(--color-ok-text,#166534)]"><span aria-hidden="true">★</span>Primary</span>;
}

export function VectorCollectionList({
  rows,
  drafts,
  saving,
  testing,
  primarySaving,
  actionMessage,
  onDraft,
  onSave,
  onTest,
  onPrimary,
}: CollectionListProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--color-accent,#0f766e)]">Collections</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Collection settings</h2>
          <p className="mt-2 text-sm text-slate-400">Edit provider/model/adapter and choose the primary collection.</p>
        </div>
        <p className="text-sm text-slate-500">{rows.length} configured</p>
      </div>

      <div className="mt-4 grid gap-3">
        {rows.map((row) => {
          const draft = drafts[row.key] ?? { model: row.model, provider: row.provider, adapter: row.adapter, enabled: row.enabled };
          const dirty = draft.model !== row.model || draft.provider !== row.provider || draft.adapter !== row.adapter || draft.enabled !== row.enabled;
          return (
            <article key={row.key} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-[color:var(--color-accent,#0f766e)]">{row.collection}</h3>
                    <PrimaryBadge primary={row.primary} />
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{row.key} · {row.count ?? 0} docs · {row.adapter} · {row.enabled ? 'enabled' : 'disabled'}</p>
                </div>
                <CollectionStatus row={row} />
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <label className="grid gap-2 text-sm text-slate-300">Model
                  <input className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={draft.model} onChange={(event) => onDraft(row.key, { model: event.target.value })} />
                </label>
                <label className="grid gap-2 text-sm text-slate-300">Provider
                  <input className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={draft.provider} onChange={(event) => onDraft(row.key, { provider: event.target.value })} />
                </label>
                <label className="grid gap-2 text-sm text-slate-300">Adapter
                  <select className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={draft.adapter} onChange={(event) => onDraft(row.key, { adapter: event.target.value as VectorConfigAdapter })}>
                    {ADAPTER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-sm text-slate-300">Enabled
                  <select className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={String(draft.enabled)} onChange={(event) => onDraft(row.key, { enabled: event.target.value === 'true' })}>
                    <option value="true">true</option><option value="false">false</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="focus-ring rounded-xl border border-[color:var(--color-accent,#0f766e)] px-3 py-2 text-sm font-semibold text-[color:var(--color-accent,#0f766e)] disabled:opacity-50" disabled={!dirty || saving[row.key]} type="button" onClick={() => onSave(row.key)}>{saving[row.key] ? <Spinner label="Saving" /> : 'Save'}</button>
                <button className="focus-ring rounded-xl border border-[color:var(--color-accent2,#7e22ce)] px-3 py-2 text-sm font-semibold text-[color:var(--color-accent2,#7e22ce)] disabled:opacity-50" disabled={testing[row.key]} type="button" onClick={() => onTest(row.key)}>{testing[row.key] ? <Spinner label="Testing" /> : 'Test'}</button>
                <button className="focus-ring rounded-xl border border-cyan-300/30 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50" disabled={row.primary || primarySaving === row.key} type="button" onClick={() => onPrimary(row.key)}>{primarySaving === row.key ? <Spinner label="Setting" /> : 'Set primary'}</button>
              </div>
              {actionMessage[row.key] ? <p className="mt-2 text-sm text-slate-500">{actionMessage[row.key]}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
