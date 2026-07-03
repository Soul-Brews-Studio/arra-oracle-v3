import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge } from '../components/Badge';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { MeterBar } from '../components/MeterBar';
import { SearchResultSignals } from '../components/SearchResultSignals';
import { StatCard } from '../components/StatCard';
import {
  fetchMemoryRecall,
  memoryDashboardSummary,
  memoryPreview,
  memoryToSignalResult,
  percentText,
  validTimeScore,
  validTimeWindow,
  type MemoryRecallResponse,
  type RankedMemory,
} from '../memoryDashboard';

type PageState = 'idle' | 'loading' | 'ready' | 'error';
type MemoryClient = (params?: { q?: string; asOf?: string; limit?: number }) => Promise<MemoryRecallResponse>;

function MemoryCard({ memory }: { memory: RankedMemory }) {
  const signal = memoryToSignalResult(memory);
  const rank = memory.ranking?.score ?? memory.confidence.score;
  const validScore = validTimeScore(memory);
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-lg shadow-black/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words font-mono text-sm font-semibold text-accent">{memory.title || memory.id}</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">{memoryPreview(memory.content)}</p>
        </div>
        <Badge tone={rank >= 0.75 ? 'success' : rank >= 0.45 ? 'warning' : 'danger'} ariaLabel={`Memory rank ${percentText(rank)}`}>
          rank {percentText(rank)}
        </Badge>
      </div>

      <SearchResultSignals result={signal} />

      <section aria-label="Memory valid-time" className="mt-3 rounded-xl border border-border bg-surface-muted p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">valid-time</p>
            <p className="mt-1 text-sm font-medium text-text">{validTimeWindow(memory)}</p>
          </div>
          <Badge tone={memory.validTo || memory.validUntil ? 'warning' : 'accent'}>
            {memory.validTo || memory.validUntil ? 'bounded' : 'open-ended'}
          </Badge>
        </div>
        <div className="mt-3">
          <MeterBar label="Valid-time fit" percent={validScore * 100} tone="accent2" valueText={percentText(validScore)} description="Derived from the active as-of snapshot and memory validity window." />
        </div>
      </section>

      {memory.tags?.length ? (
        <div className="mt-3 flex flex-wrap gap-1" aria-label="Memory tags">
          {memory.tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
        </div>
      ) : null}
    </article>
  );
}

export function MemoryDashboardContent({ items, total, asOf, state, error }: {
  items: RankedMemory[];
  total: number;
  asOf?: string;
  state: PageState;
  error?: string;
}) {
  const summary = useMemo(() => memoryDashboardSummary(items), [items]);
  const shown = items.length;
  return (
    <div className="grid w-full min-w-0 gap-5">
      <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="memory-dashboard-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Memory</p>
        <h1 id="memory-dashboard-title" className="mt-2 text-3xl font-semibold text-text">Memory dashboard</h1>
        <p className="mt-2 max-w-3xl text-sm text-text-muted">
          One Studio view for KB provenance, confidence, retrieval heat, and valid-time windows from /api/memory/recall.
        </p>
        {asOf ? <p className="mt-3 text-xs text-text-muted">Snapshot as of {asOf}</p> : null}
      </section>

      <section className="grid min-w-0 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(5,minmax(0,1fr))]" aria-label="Memory signal summary">
        <StatCard label="Memories" value={shown} detail={total > shown ? `${total} total available` : 'active KB memories'} tone="accent" />
        <StatCard label="High confidence" value={summary.highConfidenceCount} detail={`${percentText(summary.avgConfidence)} average`} tone="success" />
        <StatCard label="Source coverage" value={percentText(summary.sourceCoverage)} detail={`${percentText(summary.avgProvenance)} provenance avg`} tone="accent" />
        <StatCard label="Heat" value={percentText(summary.avgHeat)} detail="retrieval reinforcement" tone="warning" />
        <StatCard label="Valid-time" value={summary.validWindowCount} detail="bounded windows" tone="neutral" />
      </section>

      <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-label="Memory dashboard meters">
        <div className="grid min-w-0 gap-4 md:grid-cols-[repeat(4,minmax(0,1fr))]">
          <MeterBar label="Confidence" percent={summary.avgConfidence * 100} tone="success" valueText={percentText(summary.avgConfidence)} />
          <MeterBar label="Provenance" percent={summary.avgProvenance * 100} tone="accent" valueText={percentText(summary.avgProvenance)} />
          <MeterBar label="Heat" percent={summary.avgHeat * 100} tone="warning" valueText={percentText(summary.avgHeat)} />
          <MeterBar label="Source coverage" percent={summary.sourceCoverage * 100} tone="accent2" valueText={percentText(summary.sourceCoverage)} />
        </div>
      </section>

      {state === 'loading' ? <LoadingPanel title="Loading memory dashboard" detail="Fetching /api/memory/recall for confidence and valid-time signals." /> : null}
      {state === 'error' ? <ErrorMessage title="Memory dashboard failed." message={error || 'Unable to load memory recall.'} /> : null}
      {state === 'ready' && !items.length ? <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-text-muted">No memories matched this dashboard filter.</p> : null}
      <div className="grid min-w-0 gap-3 xl:grid-cols-[repeat(2,minmax(0,1fr))]" aria-label="Memory dashboard results">
        {items.map((memory) => <MemoryCard key={memory.id} memory={memory} />)}
      </div>
    </div>
  );
}

export function MemoryDashboardPage({ client = fetchMemoryRecall }: { client?: MemoryClient }) {
  const [query, setQuery] = useState('');
  const [asOf, setAsOf] = useState('');
  const [items, setItems] = useState<RankedMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [responseAsOf, setResponseAsOf] = useState<string | undefined>();
  const [state, setState] = useState<PageState>('idle');
  const [error, setError] = useState('');

  async function load(nextQuery = query, nextAsOf = asOf) {
    setState('loading');
    setError('');
    try {
      const response = await client({ q: nextQuery, asOf: nextAsOf, limit: 50 });
      setItems(response.items);
      setTotal(response.total);
      setResponseAsOf(response.asOf || nextAsOf || undefined);
      setState('ready');
    } catch (cause) {
      setItems([]);
      setTotal(0);
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
    }
  }

  useEffect(() => { void load('', ''); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query, asOf);
  }

  return (
    <div className="grid w-full min-w-0 gap-5">
      <form aria-label="Memory dashboard filters" className="grid gap-3 rounded-3xl border border-border bg-surface p-5 sm:grid-cols-[minmax(0,1fr)_16rem_auto] sm:p-6" onSubmit={submit}>
        <input aria-label="Memory dashboard query" className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-text placeholder:text-text-muted" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Filter memories by source, title, tag…" type="search" />
        <input aria-label="Valid-time snapshot" className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-text" value={asOf} onChange={(event) => setAsOf(event.currentTarget.value)} type="datetime-local" />
        <button className="focus-ring rounded-xl bg-accent-solid px-5 py-3 font-semibold text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50" disabled={state === 'loading'} type="submit">
          {state === 'loading' ? 'Loading…' : 'Refresh' }
        </button>
      </form>
      <MemoryDashboardContent items={items} total={total} asOf={responseAsOf} state={state} error={error} />
    </div>
  );
}
