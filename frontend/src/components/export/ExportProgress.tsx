import { ErrorMessage, Spinner } from '../AsyncState';
import type { ExportProgressState } from '../../hooks/useExport';

export interface ExportProgressProps {
  state: ExportProgressState;
  title?: string;
  onRetry?: () => void;
  onDownload?: () => void;
  className?: string;
}

function formatBytes(bytes?: number): string {
  if (!Number.isFinite(bytes)) return 'estimating';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes ?? 0;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function statusText(state: ExportProgressState): string {
  if (state.status === 'starting') return 'Starting export job';
  if (state.status === 'running') return `Exporting ${Math.round(state.progress)}%`;
  if (state.status === 'done') return 'Export ready';
  if (state.status === 'error') return 'Export failed';
  return 'Ready to export';
}

function retryButton(onRetry?: () => void) {
  if (!onRetry) return null;
  return (
    <button className="focus-ring rounded-lg border border-red-300 px-3 py-2 font-semibold text-red-700 hover:bg-red-50 dark:border-red-200/30 dark:text-red-50 dark:hover:bg-red-200/10" type="button" onClick={onRetry}>
      Retry
    </button>
  );
}

function downloadControl(state: ExportProgressState, onDownload?: () => void) {
  if (state.status !== 'done') return null;
  const classes = 'focus-ring rounded-xl bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50';
  if (onDownload) {
    return <button className={classes} type="button" onClick={onDownload}>Download export</button>;
  }
  return (
    <a className={classes} href={state.downloadUrl} download={state.filename ?? 'arra-oracle-export.zip'} aria-disabled={!state.downloadUrl}>
      Download export
    </a>
  );
}

export function ExportProgress({ state, title = 'Export app', onRetry, onDownload, className = '' }: ExportProgressProps) {
  const active = state.status === 'starting' || state.status === 'running';
  const progress = Math.min(100, Math.max(0, state.progress));

  return (
    <section className={`rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/70 sm:p-6 ${className}`} aria-labelledby="export-progress-title" aria-live="polite">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600 dark:text-teal-300">Export</p>
          <h3 id="export-progress-title" className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{title}</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{statusText(state)}</p>
        </div>
        {active ? <Spinner label="Exporting" /> : downloadControl(state, onDownload)}
      </div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600 dark:text-slate-400">Progress</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{active || state.status === 'done' ? `${Math.round(progress)}%` : 'idle'}</span>
        </div>
        <div className="h-2 rounded-full border border-slate-200 bg-slate-200 dark:border-white/10 dark:bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <div className="h-full rounded-full bg-teal-600 transition-all dark:bg-teal-300/70" style={{ width: `${active || state.status === 'done' ? progress : 0}%` }} />
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Job</dt><dd className="break-all font-mono text-slate-900 dark:text-slate-100">{state.jobId ?? 'not started'}</dd></div>
          <div><dt className="text-slate-500">File size estimate</dt><dd className="font-medium text-slate-900 dark:text-slate-100">{formatBytes(state.fileSizeEstimate)}</dd></div>
          <div><dt className="text-slate-500">File</dt><dd className="break-all font-medium text-slate-900 dark:text-slate-100">{state.filename ?? 'pending'}</dd></div>
        </dl>
      </div>

      {state.status === 'error' ? (
        <div className="mt-4">
          <ErrorMessage title="Export failed." message={state.error ?? 'The export job failed.'} action={retryButton(onRetry)} />
        </div>
      ) : null}
    </section>
  );
}
