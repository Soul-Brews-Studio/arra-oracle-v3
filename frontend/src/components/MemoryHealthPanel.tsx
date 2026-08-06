type MemorySignal = {
  heatScore?: number;
  lastRecalled?: string;
  usageCount?: number;
  heatPending: boolean;
};

const heatKeys = ['heat_score', 'heatScore', 'heat-score', 'memory_heat_score', 'memoryHeatScore'];
const recalledKeys = ['last_recalled', 'lastRecalled', 'last_recalled_at', 'lastRecalledAt', 'last_accessed_at', 'lastAccessedAt'];
const usageKeys = ['usage_count', 'usageCount', 'recall_count', 'recallCount', 'visit_count', 'visitCount'];
const heatPaths = [['ranking', 'components', 'heat'], ['confidence', 'components', 'usage']];
const usagePaths = [['confidence', 'usageCount']];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  const metadata = record(source.metadata);
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
    if (metadata[key] !== undefined) return metadata[key];
  }
  return undefined;
}

function firstPath(source: Record<string, unknown>, paths: string[][]): unknown {
  for (const path of paths) {
    let value: unknown = source;
    for (const part of path) value = record(value)[part];
    if (value !== undefined) return value;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeHeat(value: unknown): number | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined) return undefined;
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
}

function dateValue(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export function memorySignalFor(result: unknown): MemorySignal {
  const source = record(result);
  const heatScore = normalizeHeat(firstValue(source, heatKeys) ?? firstPath(source, heatPaths));
  const lastRecalled = dateValue(firstValue(source, recalledKeys));
  const usageCount = numberValue(firstValue(source, usageKeys) ?? firstPath(source, usagePaths));
  return { heatScore, lastRecalled, usageCount, heatPending: heatScore === undefined };
}

export function heatLabel(heat?: number): string {
  return heat === undefined ? 'pending' : `${Math.round(heat * 100)}%`;
}

export function lastRecalledLabel(value?: string): string {
  return value ? value.slice(0, 10) : 'not recalled yet';
}

function heatTone(heat?: number): string {
  if (heat === undefined) return 'border-warn-border bg-warn-bg text-warn-text';
  if (heat >= 0.75) return 'border-ok-border bg-ok-bg text-ok-text';
  if (heat >= 0.4) return 'border-accent-border bg-accent-soft text-accent';
  return 'border-warn-border bg-warn-bg text-warn-text';
}

export function MemorySignalBadges({ result }: { result: unknown }) {
  const signal = memorySignalFor(result);
  return (
    <>
      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${heatTone(signal.heatScore)}`}>
        heat-score {heatLabel(signal.heatScore)}
      </span>
      <span className="rounded-full border border-accent-border bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
        last-recalled {lastRecalledLabel(signal.lastRecalled)}
      </span>
      {signal.usageCount !== undefined ? (
        <span className="rounded-full border border-border bg-surface-muted px-2 py-1 text-xs text-text-muted">
          recalls {signal.usageCount}
        </span>
      ) : null}
    </>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface-muted p-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold text-text">{value}</dd>
      <dd className="mt-1 text-xs text-text-muted">{detail}</dd>
    </div>
  );
}

export function MemoryHealthPanel({ results, state = 'idle' }: { results: unknown[]; state?: string }) {
  const signals = results.map(memorySignalFor);
  const heatValues = signals.map((item) => item.heatScore).filter((value): value is number => value !== undefined);
  const recalled = signals.filter((item) => item.lastRecalled);
  const averageHeat = heatValues.length ? heatValues.reduce((sum, value) => sum + value, 0) / heatValues.length : undefined;
  const hot = heatValues.filter((value) => value >= 0.75).length;
  const cold = heatValues.filter((value) => value < 0.4).length;
  const latestRecall = recalled.map((item) => item.lastRecalled!).sort().at(-1);
  const pending = results.length - heatValues.length;

  return (
    <section className="w-full min-w-0 rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="memory-health-title">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Memory health</p>
        <h2 id="memory-health-title" className="mt-2 text-2xl font-semibold text-text">Heat and recency</h2>
        <p className="mt-2 text-sm text-text-muted">Tracks MemoryOS-style heat-score and last-recalled signals when the backend returns them.</p>
      </div>
      <dl className="grid min-w-0 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(4,minmax(0,1fr))]">
        <Stat label="Avg heat" value={heatLabel(averageHeat)} detail={heatValues.length ? `${heatValues.length}/${results.length} heat-backed` : 'waiting for heat_score'} />
        <Stat label="Hot memories" value={hot.toLocaleString()} detail="heat-score ≥ 75%" />
        <Stat label="Cold memories" value={cold.toLocaleString()} detail="heat-score < 40%" />
        <Stat label="Last recalled" value={lastRecalledLabel(latestRecall)} detail={`${recalled.length}/${results.length} recalled`} />
      </dl>
      {state !== 'ready' || !results.length ? (
        <p className="mt-4 rounded-xl border border-accent-border bg-accent-soft p-3 text-sm text-accent" role="status">
          Run a search to inspect memory health signals.
        </p>
      ) : pending ? (
        <p className="mt-4 rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn-text" role="status">
          {pending} result{pending === 1 ? '' : 's'} missing heat-score; showing a stub until the backend field lands.
        </p>
      ) : null}
    </section>
  );
}
