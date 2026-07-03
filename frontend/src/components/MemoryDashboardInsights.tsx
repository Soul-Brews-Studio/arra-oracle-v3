import { MeterBar } from './MeterBar';
import { heatLabel, lastRecalledLabel, memorySignalFor } from './MemoryHealthPanel';
import { confidenceScore, heatScore, percentLabel, titleFor, type ProvenanceSearchResult } from './searchResultView';

type MemoryInsight = ProvenanceSearchResult & Record<string, unknown>;

type ValidWindow = {
  title: string;
  start?: string;
  end?: string;
  active: boolean;
};

type SupersedeEdge = {
  from: string;
  to: string;
  at?: string;
  reason?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(source: Record<string, unknown>, keys: string[]): string | undefined {
  const metadata = record(source.metadata);
  for (const key of keys) {
    const value = source[key] ?? metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  }
  return undefined;
}

function dateText(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : value.slice(0, 24);
}

function insightTitle(result: MemoryInsight): string {
  return titleFor(result) || 'Untitled memory';
}

export function heatValue(result: unknown): number | undefined {
  const signal = memorySignalFor(result);
  if (signal.heatScore !== undefined) return signal.heatScore;
  const scored = heatScore(result as ProvenanceSearchResult);
  return scored > 0 ? scored : undefined;
}

function heatTone(heat?: number): string {
  if (heat === undefined) return 'border-warn-border bg-warn-bg text-warn-text';
  if (heat >= 0.75) return 'border-ok-border bg-ok-bg text-ok-text';
  if (heat >= 0.4) return 'border-accent2-border bg-accent2-soft text-accent2';
  return 'border-err-border bg-err-bg text-err-text';
}

function validWindow(result: MemoryInsight): ValidWindow {
  const source = record(result);
  const start = textValue(source, ['valid_from', 'validFrom', 'valid_time', 'validTime', 'createdAt', 'created_at']);
  const end = textValue(source, ['valid_until', 'validUntil', 'valid_to', 'validTo']);
  const now = Date.now();
  const startMs = start ? Date.parse(start) : Number.NEGATIVE_INFINITY;
  const endMs = end ? Date.parse(end) : Number.POSITIVE_INFINITY;
  const active = (!Number.isFinite(startMs) || startMs <= now) && (!Number.isFinite(endMs) || endMs > now);
  return { title: insightTitle(result), start: dateText(start), end: dateText(end), active };
}

export function supersedeEdge(result: unknown): SupersedeEdge | undefined {
  const source = record(result);
  const to = textValue(source, ['superseded_by', 'supersededBy']);
  if (!to) return undefined;
  return {
    from: insightTitle(source as MemoryInsight),
    to,
    at: dateText(textValue(source, ['superseded_at', 'supersededAt'])),
    reason: textValue(source, ['superseded_reason', 'supersededReason']),
  };
}

function HeatHeatmap({ results }: { results: MemoryInsight[] }) {
  return (
    <section aria-labelledby="memory-heatmap-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Heat heatmap</p>
      <h2 id="memory-heatmap-title" className="mt-2 text-2xl font-semibold text-text">Recall heat by memory</h2>
      <p className="mt-2 text-sm text-text-muted">Each tile uses semantic heat buckets and exposes the score to assistive tech.</p>
      <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(4,minmax(0,1fr))]" role="list" aria-label="Memory heatmap cells">
        {results.length ? results.map((result) => {
          const heat = heatValue(result);
          return (
            <article key={result.id} className={`min-w-0 rounded-2xl border p-4 ${heatTone(heat)}`} role="listitem" aria-label={`${insightTitle(result)} heat ${heatLabel(heat)}`}>
              <p className="break-all font-mono text-sm font-semibold">{insightTitle(result)}</p>
              <p className="mt-3 text-3xl font-bold">{heatLabel(heat)}</p>
              <p className="mt-1 text-xs">last recalled {lastRecalledLabel(memorySignalFor(result).lastRecalled)}</p>
            </article>
          );
        }) : <p className="rounded-xl border border-accent-border bg-accent-soft p-3 text-sm text-accent" role="status">Run a search to populate the heatmap.</p>}
      </div>
    </section>
  );
}

function ConfidenceBars({ results }: { results: MemoryInsight[] }) {
  return (
    <section aria-labelledby="memory-confidence-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Confidence</p>
      <h2 id="memory-confidence-title" className="mt-2 text-2xl font-semibold text-text">Confidence bars</h2>
      <div className="mt-5 grid gap-4">
        {results.length ? results.map((result) => {
          const confidence = confidenceScore(result);
          const heat = heatValue(result) ?? 0;
          return (
            <article key={result.id} className="min-w-0 rounded-2xl border border-border bg-surface-muted p-4" aria-label={`${insightTitle(result)} confidence and heat`}>
              <h3 className="mb-3 break-all font-mono text-sm font-semibold text-text">{insightTitle(result)}</h3>
              <div className="grid min-w-0 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
                <MeterBar label="Confidence" percent={confidence * 100} valueText={percentLabel(confidence) ?? '0%'} tone={confidence >= 0.75 ? 'success' : confidence >= 0.45 ? 'warning' : 'danger'} description="Ranking confidence from match, freshness, and provenance signals." />
                <MeterBar label="Heat" percent={heat * 100} valueText={heatLabel(heat)} tone={heat >= 0.75 ? 'success' : heat >= 0.4 ? 'accent2' : 'warning'} description="Recall reinforcement from heat-score or usage fallback." />
              </div>
            </article>
          );
        }) : <p className="rounded-xl border border-border bg-surface-muted p-3 text-sm text-text-muted" role="status">No confidence bars yet.</p>}
      </div>
    </section>
  );
}

function ValidTimeTimeline({ results }: { results: MemoryInsight[] }) {
  const windows = results.map(validWindow);
  return (
    <section aria-labelledby="memory-valid-time-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Valid-time</p>
      <h2 id="memory-valid-time-title" className="mt-2 text-2xl font-semibold text-text">Valid-time timeline</h2>
      <ol className="mt-5 grid gap-3" aria-label="Valid-time memory windows">
        {windows.length ? windows.map((item) => (
          <li key={item.title} className="grid min-w-0 gap-2 rounded-2xl border border-border bg-surface-muted p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <p className="break-all font-mono text-sm font-semibold text-text">{item.title}</p>
              <p className="mt-1 text-xs text-text-muted">{item.start ?? 'unknown start'} → {item.end ?? 'open-ended'}</p>
            </div>
            <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${item.active ? 'border-ok-border bg-ok-bg text-ok-text' : 'border-warn-border bg-warn-bg text-warn-text'}`}>
              {item.active ? 'valid now' : 'outside window'}
            </span>
          </li>
        )) : <li className="rounded-xl border border-border bg-surface-muted p-3 text-sm text-text-muted">No valid-time windows yet.</li>}
      </ol>
    </section>
  );
}

function SupersedeChainViewer({ results }: { results: MemoryInsight[] }) {
  const edges = results.map(supersedeEdge).filter((edge): edge is SupersedeEdge => Boolean(edge));
  return (
    <section aria-labelledby="memory-supersede-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Supersede chain</p>
      <h2 id="memory-supersede-title" className="mt-2 text-2xl font-semibold text-text">Supersede-chain viewer</h2>
      <div className="mt-5 grid gap-3" role="list" aria-label="Supersede chains">
        {edges.length ? edges.map((edge) => (
          <article key={`${edge.from}:${edge.to}`} className="min-w-0 rounded-2xl border border-warn-border bg-warn-bg p-4 text-warn-text" role="listitem">
            <p className="break-all font-mono text-sm font-semibold">{edge.from} → {edge.to}</p>
            <p className="mt-2 text-xs">{edge.at ? `superseded ${edge.at}` : 'supersede time pending'}{edge.reason ? ` · ${edge.reason}` : ''}</p>
          </article>
        )) : <p className="rounded-xl border border-ok-border bg-ok-bg p-3 text-sm text-ok-text" role="status">No supersede links in these results.</p>}
      </div>
    </section>
  );
}

export function MemoryDashboardInsights({ results }: { results: unknown[] }) {
  const typed = results.map((item) => item as MemoryInsight);
  return (
    <div className="grid w-full min-w-0 gap-5">
      <HeatHeatmap results={typed} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
        <ConfidenceBars results={typed} />
        <ValidTimeTimeline results={typed} />
      </div>
      <SupersedeChainViewer results={typed} />
    </div>
  );
}
