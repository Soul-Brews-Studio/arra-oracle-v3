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

function statusClass(state: ExportProgressState): string {
  if (state.status === 'done') return 'border-ok-border bg-ok-bg text-ok-text';
  if (state.status === 'error') return 'border-err-border bg-err-bg text-err-text';
  if (state.status === 'starting' || state.status === 'running') return 'border-accent-border bg-accent-soft text-accent';
  return 'border-warn-border bg-warn-bg text-warn-text';
}

function progressBarClass(state: ExportProgressState): string {
  if (state.status === 'done') return 'bg-ok-text';
  if (state.status === 'error') return 'bg-err-text';
  return 'bg-accent-solid';
}

function retryButton(onRetry?: () => void) {
  if (!onRetry) return null;
  return (
    <button className="focus-ring rounded-lg border border-err-border px-3 py-2 font-semibold text-err-text hover:bg-err-bg dark:border-err-border dark:text-err-text dark:hover:bg-err-bg" type="button" onClick={onRetry}>
      Retry
    </button>
  );
}

function downloadControl(state: ExportProgressState, onDownload?: () => void) {
  if (state.status !== 'done') return null;
  const classes = 'focus-ring rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-on-accent transition hover:bg-accent-solid disabled:cursor-not-allowed disabled:opacity-50';
  if (!onDownload && !state.downloadUrl) {
    return <button className={classes} type="button" disabled>Preparing download</button>;
  }
  if (onDownload) {
    return <button className={classes} type="button" onClick={onDownload}>Download export</button>;
  }
  return (
    <a className={classes} href={state.downloadUrl} download={state.filename ?? 'arra-oracle-export.zip'}>
      Download export
    </a>
  );
}

export function ExportProgress({ state, title = 'Export app', onRetry, onDownload, className = '' }: ExportProgressProps) {
  const active = state.status === 'starting' || state.status === 'running';
  const progress = Math.min(100, Math.max(0, state.progress));

  return (
    <section className={`rounded-3xl border border-border bg-surface p-5 shadow-sm dark:border-border dark:bg-surface sm:p-6 ${className}`} aria-labelledby="export-progress-title" aria-live="polite">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent dark:text-accent">Export</p>
          <h3 id="export-progress-title" className="mt-2 text-xl font-semibold text-on-accent dark:text-text">{title}</h3>
          <p className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(state)}`}>
            {statusText(state)}
          </p>
        </div>
        {active ? <Spinner label="Exporting" /> : downloadControl(state, onDownload)}
      </div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-border bg-surface-muted p-4 dark:border-border dark:bg-surface-muted">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted dark:text-text-muted">Progress</span>
          <span className="font-medium text-text dark:text-text">{active || state.status === 'done' ? `${Math.round(progress)}%` : 'idle'}</span>
        </div>
        <div className="h-2 rounded-full border border-border bg-surface-muted dark:border-border dark:bg-field/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={statusText(state)}>
          <div className={`h-full rounded-full transition-all ${progressBarClass(state)}`} style={{ width: `${active || state.status === 'done' ? progress : 0}%` }} />
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-text-muted">Job</dt><dd className="break-all font-mono text-text dark:text-text">{state.jobId ?? 'not started'}</dd></div>
          <div><dt className="text-text-muted">File size estimate</dt><dd className="font-medium text-text dark:text-text">{formatBytes(state.fileSizeEstimate)}</dd></div>
          <div><dt className="text-text-muted">File</dt><dd className="break-all font-medium text-text dark:text-text">{state.filename ?? 'pending'}</dd></div>
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
