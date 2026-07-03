import { useEffect, useMemo, useState } from 'react';
import { fetchTraces, type TraceSummary, type TracesResponse } from '../api';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { EmptyState } from '../components/EmptyState';
import { StatCard } from '../components/StatCard';

type PageState = 'loading' | 'ready' | 'error';
type TraceLoader = (limit?: number, offset?: number) => Promise<TracesResponse>;

const LIMIT = 50;

function timeLabel(value: number): string {
  if (!Number.isFinite(value)) return 'unknown time';
  return new Date(value).toLocaleString();
}

function countLabel(trace: TraceSummary): string {
  const parts = [
    `${trace.fileCount} file${trace.fileCount === 1 ? '' : 's'}`,
    `${trace.commitCount} commit${trace.commitCount === 1 ? '' : 's'}`,
    `${trace.issueCount} issue${trace.issueCount === 1 ? '' : 's'}`,
  ];
  return parts.join(' · ');
}

export function activitySummary(state: PageState, total: number, shown: number): string {
  if (state === 'loading') return 'Loading trace activity…';
  if (state === 'error') return 'Trace activity could not be loaded.';
  return total ? `Showing ${shown} of ${total} traces.` : 'No traces have been captured yet.';
}

function TraceCard({ trace }: { trace: TraceSummary }) {
  return (
    <article className="min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5" aria-label={`Trace ${trace.traceId}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-all font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">{trace.traceId}</p>
          <h2 className="mt-2 break-words text-xl font-semibold text-text">{trace.query || 'Untitled trace'}</h2>
          <p className="mt-2 text-sm text-text-muted">{countLabel(trace)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-accent-border bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
          {trace.status}
        </span>
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 text-sm text-text-muted sm:grid-cols-[repeat(2,minmax(0,1fr))]">
        <div><dt>Scope</dt><dd className="font-medium text-text">{trace.scope}</dd></div>
        <div><dt>Depth</dt><dd className="font-medium text-text">{trace.depth}</dd></div>
        <div><dt>Created</dt><dd className="font-medium text-text">{timeLabel(trace.createdAt)}</dd></div>
        <div><dt>Awakening</dt><dd className="font-medium text-text">{trace.hasAwakening ? 'captured' : 'pending'}</dd></div>
      </dl>
    </article>
  );
}

function TraceGrid({ traces }: { traces: TraceSummary[] }) {
  if (!traces.length) return <EmptyState text="No traces returned from /api/traces." />;
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[repeat(2,minmax(0,1fr))]" aria-label="Trace activity cards">
      {traces.map((trace) => <TraceCard key={trace.traceId} trace={trace} />)}
    </div>
  );
}

export function ActivityPage({ load = fetchTraces }: { load?: TraceLoader }) {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');

  async function refresh() {
    setState('loading');
    setError('');
    try {
      const response = await load(LIMIT, 0);
      setTraces(response.traces);
      setTotal(response.total);
      setState('ready');
    } catch (cause) {
      setTraces([]);
      setTotal(0);
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
    }
  }

  useEffect(() => { void refresh(); }, [load]);
  const distilled = traces.filter((trace) => trace.status === 'distilled').length;
  const summary = useMemo(() => activitySummary(state, total, traces.length), [state, total, traces.length]);

  return (
    <section className="grid w-full min-w-0 gap-5" aria-labelledby="activity-page-title">
      <header className="rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Activity / Traces</p>
            <h1 id="activity-page-title" className="mt-2 text-3xl font-semibold text-text">Trace activity</h1>
            <p className="mt-2 text-sm text-text-muted">DB-backed activity from /api/traces, balanced for wide Studio layouts.</p>
          </div>
          <button className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      <section className="grid min-w-0 gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))]" aria-label="Trace activity summary">
        <StatCard label="Traces" value={traces.length} detail={total > traces.length ? `${total} total` : summary} tone="accent" />
        <StatCard label="Distilled" value={distilled} detail="awakening-ready traces" tone="success" />
        <StatCard label="Raw" value={traces.length - distilled} detail="awaiting review/distill" tone="warning" />
      </section>

      <p className="text-sm text-text-muted">{summary}</p>
      {state === 'loading' ? <LoadingPanel title="Loading trace activity…" detail="Fetching /api/traces from the Elysia backend." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load trace activity." message={error} /> : null}
      {state === 'ready' ? <TraceGrid traces={traces} /> : null}
    </section>
  );
}
