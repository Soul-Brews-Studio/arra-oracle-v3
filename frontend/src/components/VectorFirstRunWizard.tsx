import { useMemo, useState } from 'react';
import { ErrorMessage, Spinner } from './AsyncState';
import { fetchJson, type VectorConfigRow } from '../pages/vectorSettingsHelpers';

type WizardStep = 0 | 1 | 2;

type WizardProps = {
  rows: VectorConfigRow[];
  onRefresh: () => Promise<void> | void;
};

const stepCopy = [
  {
    title: 'Choose a storage adapter',
    detail: 'Start with the current adapter defaults, then change collection rows only when you need a remote vector DB.',
  },
  {
    title: 'Verify collection health',
    detail: 'Reload the vector runtime cache and confirm at least one collection reports healthy before indexing.',
  },
  {
    title: 'Build the first index',
    detail: 'Kick off the primary collection first. The Index Manager below tracks progress and lets you reindex each model.',
  },
] as const;

export function firstRunReadiness(rows: VectorConfigRow[]): string {
  if (!rows.length) return 'No collections loaded yet.';
  const healthy = rows.filter((row) => row.health?.ok).length;
  const primary = rows.find((row) => row.primary) ?? rows[0];
  return `${rows.length} collections · ${healthy}/${rows.length} healthy · first index ${primary.key}`;
}

function primaryKey(rows: VectorConfigRow[]): string | null {
  return (rows.find((row) => row.primary) ?? rows[0])?.key ?? null;
}

export function VectorFirstRunWizard({ rows, onRefresh }: WizardProps) {
  const [step, setStep] = useState<WizardStep>(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const readiness = useMemo(() => firstRunReadiness(rows), [rows]);
  const copy = stepCopy[step];

  async function refreshHealth() {
    setBusy(true);
    setError('');
    try {
      await fetchJson('/api/v1/vector/config/reload', { method: 'POST' });
      await onRefresh();
      setMessage('Runtime cache reloaded. Review collection health below.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function startPrimaryIndex() {
    const model = primaryKey(rows);
    if (!model) {
      setError('Load vector collections before starting the first index.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await fetchJson('/api/vector/index/start', { method: 'POST', body: JSON.stringify({ model }) });
      setMessage(`Started first index for ${model}. Watch progress in the Index Manager.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-purple-300/20 bg-purple-300/10 p-5 sm:p-6" aria-labelledby="first-run-wizard-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-200">First-run wizard</p>
          <h2 id="first-run-wizard-title" className="mt-2 text-2xl font-semibold text-white">{copy.title}</h2>
          <p className="mt-2 max-w-3xl text-sm text-purple-100/80">{copy.detail}</p>
          <p className="mt-3 text-sm text-purple-100">{readiness}</p>
        </div>
        <ol className="flex gap-2" aria-label="First-run steps">
          {stepCopy.map((item, index) => (
            <li key={item.title} className={`h-2 w-10 rounded-full ${index <= step ? 'bg-purple-200' : 'bg-white/20'}`} />
          ))}
        </ol>
      </div>

      {error ? <div className="mt-4"><ErrorMessage title="First-run step failed." message={error} /></div> : null}
      {message ? <p className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-sm text-purple-100">{message}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="focus-ring rounded-xl border border-white/10 px-3 py-2 text-sm text-purple-100 hover:border-purple-200/60" disabled={step === 0} type="button" onClick={() => setStep((step - 1) as WizardStep)}>Back</button>
        {step === 1 ? (
          <button className="focus-ring rounded-xl bg-purple-200 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60" disabled={busy} type="button" onClick={() => void refreshHealth()}>{busy ? <Spinner label="Reloading" /> : 'Reload and test health'}</button>
        ) : null}
        {step === 2 ? (
          <button className="focus-ring rounded-xl bg-teal-200 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60" disabled={busy || !rows.length} type="button" onClick={() => void startPrimaryIndex()}>{busy ? <Spinner label="Starting" /> : 'Start first index'}</button>
        ) : null}
        <button className="focus-ring rounded-xl border border-purple-200/40 px-3 py-2 text-sm font-semibold text-purple-100 hover:bg-purple-200/10" disabled={step === 2} type="button" onClick={() => setStep((step + 1) as WizardStep)}>Next</button>
      </div>
    </section>
  );
}
