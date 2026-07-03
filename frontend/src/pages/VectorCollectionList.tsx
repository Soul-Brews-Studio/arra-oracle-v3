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
    ? 'border-ok-border bg-ok-bg text-ok-text'
    : 'border-err-border bg-err-bg text-err-text';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${classes}`}><span aria-hidden="true">●</span>{label}</span>;
}

function PrimaryBadge({ primary }: { primary?: boolean }) {
  if (!primary) return null;
  return <span className="inline-flex items-center gap-1 rounded-full border border-ok-border bg-ok-bg px-2 py-1 text-xs text-ok-text"><span aria-hidden="true">★</span>Primary</span>;
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
    <section className="rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Collections</p>
          <h2 className="mt-2 text-2xl font-semibold text-text">Collection settings</h2>
          <p className="mt-2 text-sm text-text-muted">Edit provider/model/adapter and choose the primary collection.</p>
        </div>
        <p className="text-sm text-text-muted">{rows.length} configured</p>
      </div>

      <div className="mt-4 grid gap-3">
        {rows.map((row) => {
          const draft = drafts[row.key] ?? { model: row.model, provider: row.provider, adapter: row.adapter, enabled: row.enabled };
          const dirty = draft.model !== row.model || draft.provider !== row.provider || draft.adapter !== row.adapter || draft.enabled !== row.enabled;
          return (
            <article key={row.key} className="rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-accent">{row.collection}</h3>
                    <PrimaryBadge primary={row.primary} />
                  </div>
                  <p className="mt-1 text-sm text-text-muted">{row.key} · {row.count ?? 0} docs · {row.adapter} · {row.enabled ? 'enabled' : 'disabled'}</p>
                </div>
                <CollectionStatus row={row} />
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <label className="grid gap-2 text-sm text-text-muted">Model
                  <input className="focus-ring rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={draft.model} onChange={(event) => onDraft(row.key, { model: event.target.value })} />
                </label>
                <label className="grid gap-2 text-sm text-text-muted">Provider
                  <input className="focus-ring rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={draft.provider} onChange={(event) => onDraft(row.key, { provider: event.target.value })} />
                </label>
                <label className="grid gap-2 text-sm text-text-muted">Adapter
                  <select className="focus-ring rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={draft.adapter} onChange={(event) => onDraft(row.key, { adapter: event.target.value as VectorConfigAdapter })}>
                    {ADAPTER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-sm text-text-muted">Enabled
                  <select className="focus-ring rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={String(draft.enabled)} onChange={(event) => onDraft(row.key, { enabled: event.target.value === 'true' })}>
                    <option value="true">true</option><option value="false">false</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="focus-ring rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent disabled:opacity-50" disabled={!dirty || saving[row.key]} type="button" onClick={() => onSave(row.key)}>{saving[row.key] ? <Spinner label="Saving" /> : 'Save'}</button>
                <button className="focus-ring rounded-xl border border-accent2-border px-3 py-2 text-sm font-semibold text-accent2 disabled:opacity-50" disabled={testing[row.key]} type="button" onClick={() => onTest(row.key)}>{testing[row.key] ? <Spinner label="Testing" /> : 'Test'}</button>
                <button className="focus-ring rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent disabled:opacity-50" disabled={row.primary || primarySaving === row.key} type="button" onClick={() => onPrimary(row.key)}>{primarySaving === row.key ? <Spinner label="Setting" /> : 'Set primary'}</button>
              </div>
              {actionMessage[row.key] ? <p className="mt-2 text-sm text-text-muted">{actionMessage[row.key]}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
